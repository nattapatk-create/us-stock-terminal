import { PRIORITY, assertDailyBudget, fhQueue, isTransientFhError, providerHeadroom, tdBatchSize, tdQueue } from "./quotaEngine.js";
import { bumpFhCalls, bumpTdCalls, safeSetItem } from "./priceCache.js";
import { fhAuthedFetch, fhRequestPair, tdAuthedFetch, tdRequestPair } from "./authRequest.js";
import { MIN_BARS_FOR_FULL_INDICATORS, OUTPUTSIZE_BY_INTERVAL } from "../utils/indicators.js";
import { FH_BASE, TD_BASE } from "../data/appConfig.js";
import { ApiError, ApiErrorKind, describeApiErrorForLog } from "./apiError.js";

export function isTransientTdError(data, res) {
  const msg = (data?.message || "").toLowerCase();
  return res.status === 429 || data?.code === 429 ||
    msg.includes("run out of api credits") || msg.includes("too many requests") || msg.includes("limit");
}

// อ่าน body เป็น JSON แบบไม่โยน error ทิ้ง — คืน parseError แยกออกมาแทน เพื่อให้ผู้เรียกตัดสินใจ
// เองว่า response.ok=true แต่ parse ไม่ได้ (data parse error) ต่างจาก response ที่ไม่มี body เลย
async function readJsonSafe(res) {
  try {
    return { data: await res.json(), parseError: null };
  } catch (parseError) {
    return { data: null, parseError };
  }
}

// Finnhub ใช้ HTTP 403 ทั้งกรณี "ไม่มีสิทธิ์เข้าถึง endpoint นี้" (auth จริง) และกรณี "เกินโควตา
// ของแผนฟรี" (เอกสารทางการไม่แยกรหัสสถานะต่างกัน ดู isTransientFhError ในquotaEngine.js) จึงต้อง
// เช็คข้อความใน body เพิ่มก่อนตัดสินว่าเป็น auth error จริง ๆ ไม่ใช่แค่โดน rate limit
function looksLikeAuthMessage(msg) {
  const m = (msg || "").toLowerCase();
  return m.includes("invalid api key") || m.includes("invalid token") ||
    m.includes("unauthorized") || m.includes("don't have access") || m.includes("access denied");
}

/* ------------------------------------------------------------
   ตัวช่วยยิง HTTP ที่ผูกกับ Quota Engine
   - เช็คโควตารายวันก่อนเข้าคิว (รู้ตัวก่อนยิง ไม่ใช่ปล่อยให้พังทีละคำขอ)
   - นับ credit ตามจริง (batch = จำนวนสัญลักษณ์)
   - เจอ 429 → สั่งเบรกตัวเองอัตโนมัติ (penalize) แล้ว retry ในคิวเดิม
   ------------------------------------------------------------ */
// รับ "pair" ({ header, query }) จาก tdRequestPair() แทนการรับ url สำเร็จรูปตัวเดียว — ข้างในจะลอง
// ยิงด้วย header ก่อนเสมอ (ไม่มี key ใน URL) แล้วถอยไปใช้ query string อัตโนมัติเฉพาะตอน header ใช้
// ไม่ได้จริง ๆ (ดูเหตุผลเต็มใน authRequest.js)
// จัดหมวด error อย่างเป็นระบบก่อน parse/ใช้ JSON เสมอ (ตามเกณฑ์งานวันนี้):
//   1) เช็ค res.status ก่อน — 401 (และ 403 ของ Twelve Data ซึ่งไม่กำกวมเหมือนของ Finnhub) แปลว่า
//      key ผิด/หมดสิทธิ์แน่นอน โยน ApiError(AUTH) ทันทีโดยไม่ retry (ลองใหม่ไปก็ได้ผลเดิม)
//   2) 5xx = ปัญหาฝั่ง provider เอง — ลอง retry ตามจำนวนที่กำหนด แล้วโยน ApiError(SERVER) ถ้ายังไม่หาย
//   3) 429 หรือ payload ที่บอกว่าชนโควตา (isTransientTdError/isTransientFhError) — ลอง retry
//      พร้อม penalize ตัวเอง (เหมือนเดิม) แล้วโยน ApiError(RATE_LIMIT) ถ้า retry ครบแล้วยังติด
//   4) response.ok แต่ body parse เป็น JSON ไม่ได้ — ApiError(PARSE)
//   5) ที่เหลือ (เช่น 200 ที่ payload มีรูปร่างไม่ตรงคาด) คืน {data, res} ตามเดิม ให้ผู้เรียกที่
//      รู้ความหมายของ field เฉพาะทาง (fetchQuote, fetchFinnhubQuote ฯลฯ) ตัดสินใจเอง
// (network error จาก fetch เองไม่ต้องจัดการที่นี่ — tdAuthedFetch/fhAuthedFetch โยน
// ApiError(NETWORK) ให้แล้วตั้งแต่ชั้น secureFetch.js)
export async function tdRequest(pair, { cost = 1, priority = PRIORITY.NORMAL, retries = 1 } = {}) {
  assertDailyBudget("td", cost);
  return tdQueue(async () => {
    bumpTdCalls(cost);
    let data = null, res = null, parseError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      res = await tdAuthedFetch(pair.header, pair.query);
      ({ data, parseError } = await readJsonSafe(res));

      if (res.status === 401 || res.status === 403) {
        throw new ApiError(ApiErrorKind.AUTH, { provider: "td", status: res.status, detail: data?.message });
      }
      if (res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        throw new ApiError(ApiErrorKind.SERVER, { provider: "td", status: res.status, detail: data?.message });
      }
      if (isTransientTdError(data, res)) {
        if (attempt === retries) {
          throw new ApiError(ApiErrorKind.RATE_LIMIT, { provider: "td", status: res.status, detail: data?.message });
        }
        tdQueue.penalize(cost);                       // ประมาณเพดานสูงไป → หน่วงตัวเองชั่วคราว
        bumpTdCalls(cost);                            // ครั้งที่ลองใหม่ก็เสีย credit จริงเช่นกัน
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      if (parseError) {
        throw new ApiError(ApiErrorKind.PARSE, { provider: "td", status: res.status, cause: parseError });
      }
      break;
    }
    return { data, res };
  }, { cost, priority });
}

export async function fhRequest(pair, { priority = PRIORITY.NORMAL, retries = 1 } = {}) {
  assertDailyBudget("fh", 1);
  return fhQueue(async () => {
    bumpFhCalls();
    let res = null, data = null, parseError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      res = await fhAuthedFetch(pair.header, pair.query);
      ({ data, parseError } = await readJsonSafe(res));

      if (res.status === 401) {
        throw new ApiError(ApiErrorKind.AUTH, { provider: "fh", status: res.status, detail: data?.error });
      }
      if (res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        throw new ApiError(ApiErrorKind.SERVER, { provider: "fh", status: res.status, detail: data?.error });
      }
      if (isTransientFhError(res)) {
        // 403 ของ Finnhub กำกวม (ดู looksLikeAuthMessage ด้านบน) — เช็คข้อความก่อนเผื่อเป็น auth จริง
        if (res.status === 403 && looksLikeAuthMessage(data?.error)) {
          throw new ApiError(ApiErrorKind.AUTH, { provider: "fh", status: res.status, detail: data?.error });
        }
        if (attempt === retries) {
          throw new ApiError(ApiErrorKind.RATE_LIMIT, { provider: "fh", status: res.status, detail: data?.error });
        }
        fhQueue.penalize(2);
        bumpFhCalls();
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      if (parseError) {
        throw new ApiError(ApiErrorKind.PARSE, { provider: "fh", status: res.status, cause: parseError });
      }
      break;
    }
    return { data, res };
  }, { cost: 1, priority });
}

export function normalizeBars(values) {
  return values.slice().reverse().map((v) => ({
    date: v.datetime, open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +v.volume,
  }));
}

// ยิง /time_series หลายสัญลักษณ์ใน "คำขอเดียว" — Twelve Data คิด credit เท่าจำนวนสัญลักษณ์
// (ดู TD_BATCH_HARD_CAP / tdBatchSize ที่หนีบขนาดก้อนไม่ให้ทะลุเพดาน credit ต่อนาที)
async function rawFetchSeriesBatch(symbols, tdKey, interval, size, priority) {
  const cost = symbols.length;
  const symbolParam = symbols.map(encodeURIComponent).join(",");
  const baseUrl = `${TD_BASE}/time_series?symbol=${symbolParam}&interval=${interval}&outputsize=${size}`;
  const { data } = await tdRequest(tdRequestPair(baseUrl, tdKey), { cost, priority });
  const out = {};
  if (symbols.length === 1) {
    // คำขอสัญลักษณ์เดียว Twelve Data ตอบ {meta, values} ตรง ๆ ไม่ห่อด้วยชื่อสัญลักษณ์
    const entry = data && data.values ? data : data?.[symbols[0]];
    out[symbols[0]] = entry?.values ? normalizeBars(entry.values) : null;
    return out;
  }
  for (const s of symbols) {
    const entry = data?.[s];
    out[s] = entry?.values ? normalizeBars(entry.values) : null;
  }
  return out;
}

// ============================================================
// ตัวรวบคำขอ (coalescer) ของ Twelve Data /time_series
// ------------------------------------------------------------
// เดิมแต่ละจุดในแอปตัดสินใจ "ขนาดก้อน" กันเอง (30 บ้าง, ทีละตัวบ้าง) ซึ่งทั้งไม่สอดคล้องกับเพดาน
// credit จริง และทำให้คำขอของหน้าจอคนละส่วนที่เกิดพร้อมกันกลายเป็นหลายคำขอโดยไม่จำเป็น
// ตอนนี้ทุกเส้นทางเรียก requestSeries() ตัวเดียว แล้วตัวรวบนี้จะ:
//   1) หน่วงสั้น ๆ (SERIES_COALESCE_MS) เพื่อรอเพื่อนบ้านที่ขอในจังหวะเดียวกัน
//   2) ยุบสัญลักษณ์ซ้ำให้เหลือครั้งเดียว (เช่น การ์ดหุ้นกับตัวสแกนขอ NVDA พร้อมกัน = ยิงครั้งเดียว)
//   3) ตัดก้อนตามเพดาน credit ต่อนาทีที่ใช้ได้จริง (tdBatchSize)
// ผลคือโหลด Watchlist 20 ตัว = 1-3 คำขอ แทนที่จะเป็น 20 คำขอเรียงคิวทีละ ~7.7 วินาที
// ============================================================
export const SERIES_COALESCE_MS = 90;
export const seriesBuffers = new Map();   // key -> { items: [...] , timer }
export const seriesInflight = new Map();  // key+symbol -> Promise (กันยิงซ้ำระหว่างที่คำขอยังไม่กลับ)

export function flushSeriesBuffer(key) {
  const buf = seriesBuffers.get(key);
  if (!buf || buf.items.length === 0) return;
  if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }

  const chunkLimit = tdBatchSize();
  const bySymbol = new Map();
  const taken = [];
  for (const item of buf.items) {
    if (!bySymbol.has(item.symbol) && bySymbol.size >= chunkLimit) break;
    if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, []);
    bySymbol.get(item.symbol).push(item);
    taken.push(item);
  }
  buf.items = buf.items.slice(taken.length);
  if (buf.items.length === 0) seriesBuffers.delete(key);
  else if (!buf.timer) buf.timer = setTimeout(() => flushSeriesBuffer(key), SERIES_COALESCE_MS);

  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) return;
  const { tdKey, interval, size } = buf.meta;
  const priority = Math.min(...taken.map((i) => i.priority));

  const p = rawFetchSeriesBatch(symbols, tdKey, interval, size, priority);
  for (const sym of symbols) {
    const inflightKey = `${key}|${sym}`;
    const symPromise = p.then((map) => map[sym]);
    seriesInflight.set(inflightKey, symPromise);
    symPromise
      .then(
        (bars) => bySymbol.get(sym).forEach((it) => it.resolve(bars)),
        (err) => bySymbol.get(sym).forEach((it) => it.reject(err))
      )
      .finally(() => seriesInflight.delete(inflightKey));
  }
}

export function requestSeries(symbol, tdKey, interval, size, priority = PRIORITY.NORMAL) {
  const key = `${interval}|${size}`;
  const inflightKey = `${key}|${symbol}`;
  const inflight = seriesInflight.get(inflightKey);
  if (inflight) return inflight;                    // มีคำขอเดียวกันวิ่งอยู่แล้ว → ใช้ผลร่วมกัน
  return new Promise((resolve, reject) => {
    let buf = seriesBuffers.get(key);
    if (!buf) {
      buf = { items: [], timer: null, meta: { tdKey, interval, size } };
      seriesBuffers.set(key, buf);
    }
    buf.meta.tdKey = tdKey;
    buf.items.push({ symbol, resolve, reject, priority });
    const distinct = new Set(buf.items.map((i) => i.symbol)).size;
    if (distinct >= tdBatchSize()) flushSeriesBuffer(key);
    else if (!buf.timer) buf.timer = setTimeout(() => flushSeriesBuffer(key), SERIES_COALESCE_MS);
  });
}

export async function fetchSeries(symbol, tdKey, interval = "1week", outputsize = null, opts = {}) {
  const size = outputsize || OUTPUTSIZE_BY_INTERVAL[interval] || 220;
  const priority = opts.priority != null ? opts.priority : PRIORITY.INTERACTIVE;
  const bars = await requestSeries(symbol, tdKey, interval, size, priority);
  // แก้บั๊ก "ราคาล่าสุดไม่โหลด" สำหรับหุ้นที่เพิ่งเข้าตลาดไม่นาน (เช่นหุ้นที่เพิ่ง IPO ซึ่งที่
  // Timeframe รายสัปดาห์จะมีข้อมูลย้อนหลังไม่ถึง 20 แท่ง) — คืนแท่งที่มีอยู่จริงกลับไปแทนการโยน
  // error ทิ้งทั้งเส้น ผู้เรียกที่ต้องการ indicator ครบจะเช็ค series.length ของตัวเองอยู่แล้ว
  if (!bars || bars.length === 0) {
    throw new Error(`ไม่พบข้อมูลราคาย้อนหลังของ ${symbol} ที่ Timeframe นี้ (Twelve Data)`);
  }
  if (bars.length < MIN_BARS_FOR_FULL_INDICATORS) bars.insufficientForIndicators = true;
  return bars;
}

// คงลายเซ็นเดิมไว้ให้ผู้เรียกทุกจุดใช้ได้เหมือนเดิม แต่ข้างในไม่ต้องตัดก้อนเองแล้ว — ส่งเข้า
// ตัวรวบคำขอให้จัดก้อนตามเพดาน credit จริงโดยอัตโนมัติ (คืน null สำหรับตัวที่แท่งไม่พอคำนวณ)
export async function fetchSeriesBatch(symbols, tdKey, interval = "1week", outputsize = null, opts = {}) {
  const size = outputsize || OUTPUTSIZE_BY_INTERVAL[interval] || 220;
  const uniqueSymbols = [...new Set(symbols)];
  if (uniqueSymbols.length === 0) return {};
  const priority = opts.priority != null ? opts.priority : PRIORITY.BACKGROUND;
  const entries = await Promise.all(uniqueSymbols.map(async (s) => {
    try {
      const bars = await requestSeries(s, tdKey, interval, size, priority);
      return [s, bars && bars.length >= MIN_BARS_FOR_FULL_INDICATORS ? bars : null];
    } catch (e) {
      if (e?.isQuotaExhausted) throw e;             // โควตาวันหมด = หยุดทั้งก้อน ไม่ไล่ยิงต่อให้เปลืองเวลา
      return [s, null];
    }
  }));
  return Object.fromEntries(entries);
}

// เดิม fetchQuote() ยิง Twelve Data /quote แยกต่างหาก (เปลือง credit ซ้ำซ้อนกับ /time_series
// ที่ยิงอยู่แล้ว) — ตอนนี้คำนวณ "quote" จากแท่งราคาล่าสุดใน series แทน ทำให้แต่ละสัญลักษณ์
// ใช้ Twelve Data credit เหลือแค่ 1 ครั้ง/รอบ (จากเดิม 2 ครั้ง) เร็วขึ้น ~2 เท่า และประหยัด
// โควตาลงครึ่งหนึ่งโดยไม่เสียข้อมูลที่หน้าจอใช้จริง (close, percent_change, volume)
export function deriveQuoteFromSeries(series) {
  if (!series || series.length === 0) return null;
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const prevClose = prev ? prev.close : last.open;
  const percentChange = prevClose ? ((last.close - prevClose) / prevClose) * 100 : 0;
  return {
    close: last.close,
    percent_change: percentChange,
    open: last.open,
    high: last.high,
    low: last.low,
    previous_close: prevClose,
    volume: last.volume ?? null,
  };
}

// เก็บ fetchQuote ไว้เป็นเส้นทางสำรองของ "ราคาล่าสุด" ฝั่ง Twelve Data — ตัวจัดเส้นทาง
// (fetchQuoteBalanced) จะเลือกใช้เมื่อฝั่ง Finnhub ตันหรือไม่มี key เท่านั้น
export async function fetchQuote(symbol, tdKey, opts = {}) {
  const baseUrl = `${TD_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
  const { data } = await tdRequest(tdRequestPair(baseUrl, tdKey), { cost: 1, priority: opts.priority ?? PRIORITY.INTERACTIVE });
  if (!data || data.status === "error" || !data.close) {
    throw new Error(data?.message || "ดึงราคาล่าสุดจาก Twelve Data ไม่สำเร็จ");
  }
  return {
    close: +data.close,
    percent_change: +data.percent_change,
    open: +data.open,
    high: +data.high,
    low: +data.low,
    previous_close: +data.previous_close,
    volume: data.volume ? +data.volume : null,
  };
}

// ============================================================
// จุดสมดุลภาระระหว่าง Twelve Data กับ Finnhub
// ------------------------------------------------------------
// เวอร์ชันเดิมใช้กติกาตายตัว "มี Finnhub key เมื่อไหร่ก็ใช้ Finnhub เสมอ" ซึ่งดีกว่าไม่ทำอะไร
// แต่ยังไม่ใช่การ balance จริง เพราะไม่ได้ดูเลยว่า ณ วินาทีนั้นฝั่งไหน "ว่าง" กว่ากัน — ถ้าตัวสแกน
// กำลังถล่ม Finnhub ด้วยงบการเงิน/ข่าวอยู่ คำขอราคาล่าสุดของผู้ใช้ก็ยังต่อท้ายคิว Finnhub ที่ตัน
// ทั้งที่โควตา Twelve Data อาจว่างอยู่
// ตอนนี้ตัดสินใจจาก providerHeadroom() ซึ่งรวม (โควตานาทีที่เหลือ + โควตาวันที่เหลือ + ความยาวคิว)
// ของทั้งสองฝั่งเข้าด้วยกัน แล้วเลือกฝั่งที่ว่างกว่าจริง ๆ โดยยังคงลำดับ fallback เดิมไว้:
//   ฝั่งที่ว่ากว่า → อีกฝั่ง → คำนวณจาก series ที่มีอยู่ (ไม่ยิง API เลย)
// หมายเหตุ: Finnhub /quote ถูกให้แต้มต่อเล็กน้อย เพราะเป็นคำขอ "เบา" (1 คำขอ = ข้อมูลราคาครบ)
// ขณะที่ฝั่ง Twelve Data ควรถูกสงวนไว้ให้ /time_series ซึ่งเป็นงานที่มีแต่ Twelve Data ทำได้
export const TD_QUOTE_HANDICAP = 0.6; // ถ่วงน้ำหนักฝั่ง Twelve Data ลง เพื่อสงวน credit ไว้ทำแท่งราคา
export async function fetchFinnhubQuote(symbol, fhKey, opts = {}) {
  const baseUrl = `${FH_BASE}/quote?symbol=${encodeURIComponent(symbol)}`;
  const { data } = await fhRequest(fhRequestPair(baseUrl, fhKey), { priority: opts.priority ?? PRIORITY.INTERACTIVE });
  // Finnhub คืน c=0 เมื่อไม่พบสัญลักษณ์ หรือ error/limit — ถือว่าใช้ไม่ได้ ให้ผู้เรียก fallback ต่อ
  if (data == null || !data.c) throw new Error("ดึงราคาล่าสุดจาก Finnhub ไม่สำเร็จ");
  return {
    close: +data.c,
    percent_change: data.dp != null ? +data.dp : (data.pc ? ((data.c - data.pc) / data.pc) * 100 : 0),
    open: +data.o,
    high: +data.h,
    low: +data.l,
    previous_close: +data.pc,
    volume: null, // Finnhub /quote แผนฟรีไม่มี volume — จะคง volume เดิมจาก series ไว้แทน (ดูผู้เรียก)
  };
}

export async function fetchQuoteBalanced(symbol, { tdKey, fhKey, fallbackSeries, priority } = {}) {
  const fh = (fhKey || "").trim();
  const td = (tdKey || "").trim();
  const lastVol = fallbackSeries && fallbackSeries.length ? fallbackSeries[fallbackSeries.length - 1].volume : null;
  const fromSeries = () => (fallbackSeries && fallbackSeries.length
    ? { ...deriveQuoteFromSeries(fallbackSeries), source: "series" }
    : null);

  // จัดลำดับผู้ให้บริการตาม "ความว่าง" จริง ณ ขณะนั้น แทนกติกาตายตัวแบบเดิม
  const routes = [];
  if (fh) routes.push({ provider: "fh", score: providerHeadroom("fh", 1) });
  if (td) routes.push({ provider: "td", score: providerHeadroom("td", 1) * TD_QUOTE_HANDICAP });
  routes.sort((a, b) => b.score - a.score);

  for (const route of routes) {
    if (route.score < 0) continue; // โควตารายวันของฝั่งนี้หมดแล้ว ข้ามไปเลย
    try {
      if (route.provider === "fh") {
        const q = await fetchFinnhubQuote(symbol, fh, { priority });
        return { ...q, volume: q.volume ?? lastVol ?? null, source: "finnhub" };
      }
      // ก่อนจะยอมเสีย credit ของ Twelve Data ไปกับ "ราคาล่าสุด" ถ้ามี series สดอยู่แล้วให้ใช้
      // ของเดิมก่อนเสมอ — credit ก้อนนั้นมีค่ากว่าเมื่อเก็บไว้ใช้ดึงแท่งราคา
      const cheap = fromSeries();
      if (cheap) return cheap;
      const q = await fetchQuote(symbol, td, { priority });
      return { ...q, source: "twelvedata" };
    } catch (e) {
      // เก็บ log แบบมีรายละเอียด (สถานะ/ข้อความดิบจาก provider) ไว้ debug — e.message เองที่โชว์
      // ผู้ใช้ตรง ๆ ที่จุดอื่นเป็นข้อความที่เข้าใจง่ายอยู่แล้วจาก ApiError ไม่ต้องแตะ
      console.warn(`[Quote] ${route.provider} ล้มเหลวสำหรับ ${symbol} → ลองเส้นทางถัดไป:`, describeApiErrorForLog(e));
    }
  }
  return fromSeries();
}

/* ------------------------------------------------------------
   แคชข้อมูลฝั่ง Finnhub ที่ "เปลี่ยนไม่บ่อย"
   ------------------------------------------------------------
   profile2 (ชื่อ/โลโก้/อุตสาหกรรม/Market Cap) แทบไม่เปลี่ยนเลย และ metric (Revenue/EPS Growth,
   P/E) เปลี่ยนปีละไม่กี่ครั้งตามรอบงบ แต่เดิมถูกยิงใหม่ทุกครั้งที่แคชหลักของสัญลักษณ์หมดอายุ
   (6 ชั่วโมง) — เท่ากับเผาโควตา Finnhub วันละหลายรอบเพื่อข้อมูลชุดเดิมเป๊ะ ๆ
   แยกแคชออกมาโดยให้อายุยาวกว่ามาก จึงเหลือโควตา Finnhub ไปรับภาระ "ราคาล่าสุด" ได้มากขึ้น
   ------------------------------------------------------------ */
export const FH_META_TTL = { profile: 7 * 24 * 60 * 60 * 1000, metric: 24 * 60 * 60 * 1000, news: 6 * 60 * 60 * 1000, social: 6 * 60 * 60 * 1000 };
export function readFhCache(kind, symbol) {
  try {
    const raw = localStorage.getItem(`fh-${kind}-${symbol}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - (parsed.t || 0) > (FH_META_TTL[kind] || 0)) return undefined;
    return parsed.v;
  } catch { return undefined; }
}
export function writeFhCache(kind, symbol, value) {
  safeSetItem(`fh-${kind}-${symbol}`, JSON.stringify({ t: Date.now(), v: value }));
}
// กันการยิงซ้ำของสัญลักษณ์เดียวกันที่เกิดพร้อมกันจากหลายส่วนของหน้าจอ (single-flight)
export const fhInflight = new Map();
export function fhSingleFlight(key, fn) {
  const existing = fhInflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => fhInflight.delete(key));
  fhInflight.set(key, p);
  return p;
}

export async function fetchFundamentals(symbol, fhKey, opts = {}) {
  if (!fhKey) return null;
  const cached = readFhCache("metric", symbol);
  if (cached !== undefined) return cached;
  return fhSingleFlight(`metric:${symbol}`, async () => {
    const baseUrl = `${FH_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
    const { data } = await fhRequest(fhRequestPair(baseUrl, fhKey), { priority: opts.priority ?? PRIORITY.BACKGROUND });
    const metric = data?.metric || {};
    writeFhCache("metric", symbol, metric);
    return metric;
  });
}

export async function fetchProfile(symbol, fhKey, opts = {}) {
  if (!fhKey) return null;
  const cached = readFhCache("profile", symbol);
  if (cached !== undefined) return cached;
  return fhSingleFlight(`profile:${symbol}`, async () => {
    const baseUrl = `${FH_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}`;
    const { data } = await fhRequest(fhRequestPair(baseUrl, fhKey), { priority: opts.priority ?? PRIORITY.BACKGROUND });
    writeFhCache("profile", symbol, data || null);
    return data || null;
  });
}

/* ============================================================
   STOCK UNIVERSE (POOL สำหรับตัวสแกน)
   ------------------------------------------------------------
   Pool หุ้นทั่วโลกสำหรับ "ตัวสแกนหุ้นดีราคาถูก" (เป้าหมาย ~3,000 ตัว กระจายทุกอุตสาหกรรม/
   ทุกประเทศ) เพื่อเพิ่มโอกาสเจอหุ้นที่เข้าเกณฑ์มูลค่า (Value) ให้กว้างกว่าลิสต์คัดสรรอย่างเดียว
   Pool ของตัวสแกนตอนนี้ = TRENDING_UNIVERSE (ลิสต์คัดสรรไว้ล่วงหน้า) รวมกับหุ้นสามัญ
   (Common Stock) ทั่วโลกอีกก้อนใหญ่ที่ดึงมาจาก Twelve Data endpoint "/stocks" (ดู
   fetchGlobalStockUniverse ด้านล่าง) รวมกันสูงสุด GLOBAL_UNIVERSE_TARGET_SIZE ตัว โดยเลือก
   แบบ round-robin ตามประเทศ (ดู buildDiverseUniverse) เพื่อกันไม่ให้ตลาดเดียว (โดยเฉพาะ
   สหรัฐฯ ที่มีจำนวนหุ้นเยอะสุด) ยึดพูลเกินสัดส่วนที่ตั้งไว้ — หุ้นแต่ละตัวในพูลนี้กระจายอยู่คนละ
   อุตสาหกรรมกันตามธรรมชาติของตลาด (อุตสาหกรรม/sector ที่แท้จริงจะทราบก็ต่อเมื่อดึงข้อมูลพื้นฐาน
   จาก Finnhub ของตัวที่ผ่านเกณฑ์แล้วเท่านั้น)
   รายชื่อที่ดึงมาจะถูกแคชไว้ใน localStorage หลายวัน (ดู STOCK_UNIVERSE_TTL_MS) เพราะรายชื่อ
   หุ้นในตลาดเปลี่ยนไม่บ่อย ไม่ต้องดึงใหม่ทุกครั้งที่เปิดเว็บ
   หากดึงรายชื่อทั่วโลกไม่สำเร็จ (ไม่มี Twelve Data API Key หรือเครือข่ายมีปัญหา) ระบบจะ
   "fail-open" กลับไปใช้แค่ TRENDING_UNIVERSE ไปก่อน เพื่อไม่ให้ทั้งฟีเจอร์หุ้นแนะนำใช้งานไม่ได้
   เลยเพียงเพราะพูลส่วนขยายนี้โหลดไม่สำเร็จชั่วคราว
   จากนั้นตัวสแกนจะกรองอีกชั้นด้วยเกณฑ์ "Hypergrowth VI" (ดู recommendationScan.js) ที่มาจาก
   ตัวเลขงบการเงิน/มูลค่าล้วน ๆ จาก Finnhub /stock/metric เท่านั้น: Disruptive Growth (รายได้/กำไร
   โตสูง) + Margin of Safety (PEG/PSG ถูกกว่ามูลค่ายุติธรรม) + เป้าหมายผลตอบแทนทบต้นขั้นต่ำต่อปี
   ไม่มีข่าว/โซเชียล/sector-keyword/ความผันผวนราคาปะปนอยู่ในเกณฑ์บังคับแล้ว
   ============================================================ */

export function pick(obj, keys) {
  if (!obj) return null;
  for (const k of keys) if (obj[k] != null && !Number.isNaN(obj[k])) return obj[k];
  return null;
}

/* ---------------- Global stock universe fetch (Twelve Data /stocks) ---------------- */
// ขนาดพูลหุ้นทั่วโลกสูงสุด (รวม TRENDING_UNIVERSE แล้ว) — เดิมตั้งไว้ 3,000 ตัว ซึ่ง "สแกนจบไม่ได้
// จริง" บนแผนฟรีของ Twelve Data: 1 สัญลักษณ์ = 1 credit และแผนฟรีมี 800 credit/วัน จึงต้องใช้
// เกือบ 4 วันเต็มกว่าจะไล่พูลครบหนึ่งรอบ (และ 8 credit/นาที = ~6 ชั่วโมงของเวลาเดินจริง) ผลคือ
// ผู้ใช้เห็นแถบ "กำลังสแกน..." ค้างยาวข้ามวัน ลดเหลือ 1,200 ตัว = พอดีกับโควตา ~1.5 วัน และเมื่อ
// รวมกับการสแกนหุ้นคัดสรรก่อน (ดู getWeeklyRotationOrder) มักจบด้วย Fast Stop ตั้งแต่ก้อนแรก ๆ
export const GLOBAL_UNIVERSE_TARGET_SIZE = 1200;
export const STOCK_UNIVERSE_CACHE_KEY = "us-dash-stock-universe-v1";
export const STOCK_UNIVERSE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // แคชรายชื่อหุ้นทั่วโลกไว้ 3 วัน (รายชื่อเปลี่ยนไม่บ่อย)
export const MAX_UNIVERSE_COUNTRY_RATIO = 0.35; // กันไม่ให้ตลาดเดียว (เช่น สหรัฐฯ) ยึดพูลเกิน 35% ของทั้งหมด
export const TICKER_SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/; // ตัด ticker ที่หน้าตาผิดปกติ (มีช่องว่าง/สัญลักษณ์แปลก ๆ) ทิ้ง

export function readUniverseCache() {
  try {
    const raw = localStorage.getItem(STOCK_UNIVERSE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || !parsed.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > STOCK_UNIVERSE_TTL_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}
export function writeUniverseCache(items) {
  try {
    safeSetItem(STOCK_UNIVERSE_CACHE_KEY, JSON.stringify({ items, fetchedAt: Date.now() }));
  } catch (e) {
    console.error("stock universe cache save failed", e);
  }
}

// เลือกหุ้นจากรายชื่อหุ้นสามัญ (Common Stock) ทั่วโลกที่ Twelve Data ให้มา แบบ round-robin
// ไล่ตามประเทศทีละตัว (ไม่ใช่ไล่ทีละประเทศจนหมดแล้วค่อยไปประเทศถัดไป) พร้อมกำหนดเพดานสูงสุด
// ต่อประเทศ (MAX_UNIVERSE_COUNTRY_RATIO) เพื่อให้พูลสุดท้ายกระจายตัวทั่วโลกจริง ๆ แทนที่จะเป็น
// หุ้นสหรัฐฯ ล้วนเพราะมีจำนวนในฐานข้อมูลเยอะที่สุด
export function buildDiverseUniverse(rawList, targetSize) {
  const byCountry = new Map();
  for (const raw of rawList) {
    const symbol = String(raw?.symbol || "").trim().toUpperCase();
    const country = raw?.country || null;
    if (!symbol || !country || !TICKER_SYMBOL_RE.test(symbol)) continue;
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push({
      symbol,
      country,
      sector: null,
      catalyst: null,
      name: raw.instrument_name || raw.name || null,
    });
  }
  const countries = Array.from(byCountry.keys());
  const perCountryCap = Math.max(1, Math.floor(targetSize * MAX_UNIVERSE_COUNTRY_RATIO));
  const pointers = Object.fromEntries(countries.map((c) => [c, 0]));
  const countPerCountry = Object.fromEntries(countries.map((c) => [c, 0]));
  const seen = new Set();
  const result = [];
  let addedThisRound = true;
  while (addedThisRound && result.length < targetSize) {
    addedThisRound = false;
    for (const c of countries) {
      if (result.length >= targetSize) break;
      const arr = byCountry.get(c);
      const p = pointers[c];
      if (p >= arr.length || countPerCountry[c] >= perCountryCap) continue;
      const item = arr[p];
      pointers[c] = p + 1;
      addedThisRound = true;
      if (seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      countPerCountry[c] += 1;
      result.push(item);
    }
  }
  return result;
}

// ดึงรายชื่อหุ้นสามัญ (Common Stock) ทั่วโลกจาก Twelve Data (ฟรี ไม่เสียโควตาแยกจาก quote/candle
// เพราะเป็น endpoint รายชื่อหุ้น ไม่ใช่ราคา) แล้วคัดให้เหลือพูลที่กระจายตัวทั่วโลกตามเป้าหมาย
// ใช้แคชใน localStorage ก่อนเสมอ (อายุ STOCK_UNIVERSE_TTL_MS) เพื่อลดจำนวนครั้งที่ต้องเรียกจริง
// ถ้าไม่มี Twelve Data API Key หรือเรียกไม่สำเร็จ จะคืนค่า null (fail-open — ผู้เรียกจะ fallback
// ไปใช้แค่ TRENDING_UNIVERSE แทน)
export async function fetchGlobalStockUniverse(tdKey) {
  const cached = readUniverseCache();
  if (cached && cached.length > 0) return cached;
  if (!tdKey) return null;
  try {
    // endpoint รายชื่อหุ้น (reference data) ไม่คิด credit เหมือน endpoint ราคา แต่ยังนับเป็น
    // คำขอในเพดานต่อนาที จึงส่งเข้าคิวด้วย priority ต่ำสุด (งานเบื้องหลัง) ไม่ให้แย่งคิวงานที่
    // ผู้ใช้กำลังรอดูอยู่ตรงหน้า
    const { data, res } = await tdRequest(
      tdRequestPair(`${TD_BASE}/stocks?type=Common%20Stock`, tdKey),
      { cost: 1, priority: PRIORITY.BACKGROUND, retries: 1 }
    );
    // tdRequest จัดการ 401/403/429/5xx/parse error เป็น ApiError ให้แล้ว เหลือแค่กรณี "ok:false"
    // แบบอื่น ๆ ที่ไม่เข้าเกณฑ์เหล่านั้น (เช่น 400) ให้ครอบเป็น ApiError เหมือนกันเพื่อความสม่ำเสมอ
    if (!res.ok) throw new ApiError(ApiErrorKind.UNKNOWN, { provider: "td", status: res.status, detail: data?.message });
    const rawList = Array.isArray(data?.data) ? data.data : [];
    if (rawList.length === 0) throw new Error("Twelve Data /stocks คืนรายชื่อว่างเปล่า");
    const diverse = buildDiverseUniverse(rawList, GLOBAL_UNIVERSE_TARGET_SIZE);
    if (diverse.length === 0) throw new Error("ไม่มีหุ้นที่ผ่านการกรองความถูกต้องของ ticker เลย");
    writeUniverseCache(diverse);
    return diverse;
  } catch (e) {
    console.error(
      "[Universe] ดึงรายชื่อหุ้นทั่วโลกจาก Twelve Data ไม่สำเร็จ — ใช้ TRENDING_UNIVERSE (คัดสรรไว้ล่วงหน้า) ไปก่อน",
      describeApiErrorForLog(e)
    );
    return null;
  }
}

/* ============================================================
   FORMATTERS & STYLES
   ============================================================ */
