import { HIST_CACHE_PREFIX, TX_LEDGER_KEY } from "../components/PriceChart.jsx";
import { safeSetItem } from "./priceCache.js";
import { fetchSeries } from "./priceSeries.js";

export function loadTxLedger() {
  try {
    const raw = localStorage.getItem(TX_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendTxLedgerEntries(entries) {
  const clean = (entries || []).filter((e) => e && e.symbol && e.shares > 0 && e.date);
  if (clean.length === 0) return;
  const next = [...loadTxLedger(), ...clean];
  try {
    safeSetItem(TX_LEDGER_KEY, JSON.stringify(next));
  } catch (e) {
    console.error("บันทึกประวัติการทำรายการไม่สำเร็จ", e);
  }
}

export function loadCachedDailyHistory(symbol) {
  try {
    const raw = localStorage.getItem(HIST_CACHE_PREFIX + symbol);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCachedDailyHistory(symbol, payload) {
  try {
    safeSetItem(HIST_CACHE_PREFIX + symbol, JSON.stringify(payload));
  } catch (e) {
    console.error("cache save failed", e);
  }
}

// ดึงราคาปิดรายวันย้อนหลังของ symbol (ใช้ fetchSeries เดิมที่ผ่าน tdQueue rate-limit อยู่แล้ว)
// แคชแบบ "วันที่ปฏิทิน" แทนการนับชั่วโมง — ถ้าเคยดึงมาแล้ว "วันนี้" และช่วงข้อมูลยังครอบคลุมพอ
// จะไม่ยิง Twelve Data ซ้ำอีกเลยไม่ว่าจะเปิด/รีเฟรชหน้ากี่ครั้งก็ตาม (ราคาปิดของวันก่อนหน้าไม่มีทาง
// เปลี่ยนอยู่แล้ว จึงไม่จำเป็นต้องดึงถี่กว่าวันละครั้ง) ช่วยลดจำนวนคำขอที่ต้องรอคิว rate-limit ลงมาก
// โดยไม่ต้องแตะโควตา/อัตราคำขอต่อนาทีเลย
export async function getDailyHistory(symbol, tdKey, outputsize) {
  const cached = loadCachedDailyHistory(symbol);
  const todayStr = new Date().toISOString().slice(0, 10);
  const cachedDateStr = cached?.fetchedAt ? new Date(cached.fetchedAt).toISOString().slice(0, 10) : null;
  const isFresh =
    cached && cachedDateStr === todayStr && cached.outputsize >= outputsize && Array.isArray(cached.bars);
  if (isFresh) return cached.bars;

  const bars = await fetchSeries(symbol, tdKey, "1day", outputsize);
  const compact = bars.map((b) => ({ date: String(b.date).slice(0, 10), close: b.close }));
  saveCachedDailyHistory(symbol, { fetchedAt: Date.now(), outputsize, bars: compact });
  return compact;
}

// กราฟสรุปการเติบโตของมูลค่าพอร์ตรวมทุกพอร์ต โดยอิงจากประวัติการซื้อขายจริง (ledger) x
// ราคาปิดรายวันย้อนหลังจริงของแต่ละสัญลักษณ์ — ไล่คำนวณจำนวนหุ้นสะสมทีละวันตั้งแต่วันแรกที่มี
// การซื้อหุ้นเข้าพอร์ต จนถึงวันนี้ แล้วให้ผู้ใช้เลือกช่วงเวลาดูย้อนหลังได้ (1M/YTD/1Y/Max)
