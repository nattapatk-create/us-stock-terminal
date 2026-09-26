import { FH_META_TTL } from "./priceSeries.js";
import { HIST_CACHE_PREFIX } from "../components/PriceChart.jsx";

export function symbolCacheKey(symbol) {
  return `us-dash-cache-${symbol}`;
}
export function loadCachedEntry(symbol) {
  try {
    const raw = localStorage.getItem(symbolCacheKey(symbol));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveCachedEntry(symbol, { quote, series, timeframe, fundamentals, profile }) {
  try {
    safeSetItem(
      symbolCacheKey(symbol),
      JSON.stringify({ quote, series, timeframe, fundamentals, profile, cachedAt: Date.now() })
    );
  } catch (e) {
    console.error("cache save failed", e);
  }
}

/* ============================================================
   STORAGE GARBAGE COLLECTOR
   ------------------------------------------------------------
   แอปนี้เก็บทุกอย่างไว้ใน localStorage (แคชแท่งราคาต่อสัญลักษณ์, โปรไฟล์/งบ/ข่าวจาก Finnhub,
   ราคาปิดย้อนหลัง, พูลหุ้นทั่วโลก 3,000 ตัว) แต่ไม่เคยมีอะไรลบของเก่าเลย — พอสแกนพูลใหญ่ไป
   หลายรอบ localStorage จะชนเพดานของเบราว์เซอร์ (~5MB) แล้ว setItem จะโยน QuotaExceededError
   ซึ่งโค้ดเดิม "กลืน" ทิ้งเงียบ ๆ ผลคือแคชหยุดทำงานโดยไม่มีใครรู้ แล้วแอปก็กลับไปยิง API ใหม่
   ทุกครั้งแบบไม่มีแคช = เผาโควตาทั้งสองเจ้าทิ้งวันละหลายเท่าโดยที่ผู้ใช้ไม่เห็นสาเหตุ

   ตัวเก็บกวาดนี้ทำงาน 2 จังหวะ:
     1) ตอนบูตแอป — กวาดของที่หมดอายุแน่ ๆ ทิ้ง (โหมดปกติ)
     2) ตอน setItem ล้มเหลวเพราะพื้นที่เต็ม — กวาดแบบเข้มข้น (โหมด aggressive: ตัดตามอายุจริง
        แล้วถ้ายังไม่พอ ไล่ลบแคชสัญลักษณ์ที่เก่าที่สุดก่อน แบบ LRU) แล้วลองเขียนใหม่อีกครั้ง
   ============================================================ */
export const SYMBOL_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;  // แคชแท่งราคาต่อสัญลักษณ์: เก็บไว้ไม่เกิน 7 วัน
export const HIST_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;    // ราคาปิดย้อนหลังที่ใช้ทำกราฟพอร์ต
export const SYMBOL_CACHE_KEEP = 300;                          // จำนวนแคชสัญลักษณ์สูงสุดที่ยอมให้เหลือไว้ตอนกวาดหนัก

export function isStorageFullError(e) {
  return !!e && (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 || e.code === 1014
  );
}

export function parseJsonSafe(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

// อ่าน "เวลาที่บันทึก" ของรายการหนึ่ง ๆ ในแคช โดยรู้จักรูปแบบ timestamp ของทุกชนิดที่แอปใช้
// (cachedAt / t / fetchedAt / savedAt) — คืน null ถ้าอ่านไม่ออก (ถือว่าเก่าสุด ลบก่อนได้)
export function cacheEntryTime(raw) {
  const v = parseJsonSafe(raw);
  if (!v || typeof v !== "object") return null;
  return v.cachedAt || v.t || v.fetchedAt || v.savedAt || null;
}

export function pruneStorage({ aggressive = false } = {}) {
  let removed = 0;
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    const keys = Object.keys(localStorage);
    const symbolEntries = []; // สำหรับโหมด LRU

    for (const key of keys) {
      // 1) ตัวนับโควตาของวันเก่า — ไม่มีประโยชน์แล้ว ลบได้ทันทีเสมอ
      if (/^(td|fh)-calls-\d{4}-\d{2}-\d{2}$/.test(key)) {
        if (!key.endsWith(todayKey)) { localStorage.removeItem(key); removed++; }
        continue;
      }
      // 2) แคชเมตาดาต้าฝั่ง Finnhub — เก็บเกินอายุจริงได้ 2 เท่าในโหมดปกติ (เผื่อใช้เป็นข้อมูล
      //    สำรองตอนโควตาหมด) แต่โหมดกวาดหนักจะตัดที่อายุจริงเลย
      const fhMatch = /^fh-(profile|metric|news)-/.exec(key);
      if (fhMatch) {
        const ttl = (FH_META_TTL[fhMatch[1]] || 0) * (aggressive ? 1 : 2);
        const t = cacheEntryTime(localStorage.getItem(key));
        if (!t || Date.now() - t > ttl) { localStorage.removeItem(key); removed++; }
        continue;
      }
      // 3) ราคาปิดย้อนหลังสำหรับกราฟพอร์ต
      if (key.startsWith(HIST_CACHE_PREFIX)) {
        const t = cacheEntryTime(localStorage.getItem(key));
        const maxAge = aggressive ? 24 * 60 * 60 * 1000 : HIST_CACHE_MAX_AGE;
        if (!t || Date.now() - t > maxAge) { localStorage.removeItem(key); removed++; }
        continue;
      }
      // 4) แคชแท่งราคาต่อสัญลักษณ์ — ก้อนใหญ่สุดของแอป (series หลายร้อยแท่งต่อตัว)
      if (key.startsWith("us-dash-cache-")) {
        const t = cacheEntryTime(localStorage.getItem(key));
        if (!t || Date.now() - t > SYMBOL_CACHE_MAX_AGE) { localStorage.removeItem(key); removed++; }
        else symbolEntries.push({ key, t });
        continue;
      }
    }

    // โหมดกวาดหนัก: ถ้าแคชสัญลักษณ์ยังเหลือเยอะเกินไป ลบตัวที่เก่าที่สุดออกก่อน (LRU)
    if (aggressive && symbolEntries.length > SYMBOL_CACHE_KEEP) {
      symbolEntries.sort((a, b) => a.t - b.t);
      for (const e of symbolEntries.slice(0, symbolEntries.length - SYMBOL_CACHE_KEEP)) {
        localStorage.removeItem(e.key);
        removed++;
      }
    }
  } catch (e) {
    console.warn("[Storage] กวาดแคชไม่สำเร็จ", e);
  }
  if (removed > 0) console.log(`[Storage] ล้างแคชที่หมดอายุแล้ว ${removed} รายการ${aggressive ? " (โหมดกวาดหนัก)" : ""}`);
  return removed;
}

// ใช้แทน localStorage.setItem ทุกจุดที่เขียน "แคช" (ไม่ใช่ข้อมูลผู้ใช้) — พื้นที่เต็มเมื่อไร
// ให้กวาดของเก่าทิ้งแล้วลองใหม่ ถ้ายังไม่ไหวจริง ๆ ค่อยยอมแพ้พร้อมบอกใน console ให้เห็นสาเหตุ
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isStorageFullError(e)) { console.error("cache save failed", e); return false; }
    pruneStorage({ aggressive: true });
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e2) {
      console.warn("[Storage] พื้นที่เก็บข้อมูลเต็ม เขียนแคชไม่สำเร็จแม้ล้างของเก่าแล้ว — แอปยังทำงานได้ปกติแต่จะยิง API ถี่ขึ้น", e2);
      return false;
    }
  }
}


// ยิง API ใหม่ทุกครั้งที่เปิดแอปหรือสแกนซ้ำภายในวันเดียวกัน ค่านี้ช่วยลดจำนวนการเรียก Twelve
// Data / Finnhub ลงอย่างมากเมื่อผู้ใช้เปิด/ปิดแอปหรือกดสแกนซ้ำ ๆ ในช่วงเวลาสั้น ๆ
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ชั่วโมง

export function isCacheEntryFresh(entry, timeframe, needsFundamentals) {
  if (!entry) return false;
  if (entry.timeframe !== timeframe) return false;
  if (!entry.series || entry.series.length < 20) return false;
  if (needsFundamentals && !entry.fundamentals) return false;
  const age = Date.now() - (entry.cachedAt || 0);
  return age >= 0 && age < CACHE_TTL_MS;
}

// ตัวนับจำนวนคำขอรายวันแบบ generic ใช้ร่วมกันทั้ง Twelve Data และ Finnhub เพื่อให้เห็น
// "สัดส่วนภาระ" ของแต่ละ API ชัดเจน — เดิมมีแค่ตัวนับของ Twelve Data ตัวเดียว ทำให้มองไม่ออกว่า
// Finnhub ถูกใช้งานคุ้มโควตาหรือไม่ (ส่วนใหญ่ปล่อยว่างขณะที่ Twelve Data ถูกรัดคอด้วย rate limit)
export function apiCounterKey(provider) {
  return `${provider}-calls-${new Date().toISOString().slice(0, 10)}`;
}
export function bumpApiCalls(provider, count = 1) {
  try {
    const k = apiCounterKey(provider);
    const next = (parseInt(localStorage.getItem(k), 10) || 0) + count;
    localStorage.setItem(k, String(next));
    return next;
  } catch {
    return null;
  }
}
export function getApiCallsToday(provider) {
  try {
    return parseInt(localStorage.getItem(apiCounterKey(provider)), 10) || 0;
  } catch {
    return 0;
  }
}
// รองรับ count ได้ (เช่นตอนยิงคำขอเดียวแบบ batch หลายสัญลักษณ์ — 1 HTTP request แต่เสีย
// credit เท่าจำนวนสัญลักษณ์ ต้องนับให้ตรงกับที่ Twelve Data คิด credit จริง ไม่งั้นตัวเลข
// "ใช้ไปกี่ครั้งวันนี้" ที่โชว์ผู้ใช้จะต่ำกว่าความจริงมาก)
export function bumpTdCalls(count = 1) { return bumpApiCalls("td", count); }
export function getTdCallsToday() { return getApiCallsToday("td"); }
export function bumpFhCalls() { return bumpApiCalls("fh"); }
export function getFhCallsToday() { return getApiCallsToday("fh"); }

/* ============================================================
   TECHNICAL ENGINE
   ============================================================ */
// EMA แบบ "SMA-seeded" — มาตรฐานเดียวกับ StockCharts/แพลตฟอร์มกราฟหุ้นส่วนใหญ่:
// ค่า EMA ตัวแรกที่คำนวณได้ = ค่าเฉลี่ยเลขคณิต (SMA) ของ `period` แท่งแรกที่มีข้อมูลครบ
// จากนั้นจึงใช้สูตร EMA แบบวนซ้ำต่อจากจุดนั้น (ก่อนหน้านั้นเป็น null เพราะข้อมูลไม่พอ)
// วิธีเดิม (seed = แท่งแรกสุดของราคาที่มี) ทำให้ EMA คลาดเคลื่อนจากค่าที่แพลตฟอร์มอื่นแสดง
// มากในช่วงแรก และคลาดเคลื่อนต่อเนื่องไปเรื่อย ๆ โดยเฉพาะ EMA200 ถ้าข้อมูลย้อนหลังมีไม่มากพอ
