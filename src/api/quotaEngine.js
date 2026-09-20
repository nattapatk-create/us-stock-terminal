import { getApiCallsToday, safeSetItem } from "./priceCache.js";
import { secureFetch } from "./secureFetch.js";
import { redactSecrets } from "../utils/redact.js";
import { ApiError, ApiErrorKind } from "./apiError.js";

/* ============================================================
   QUOTA ENGINE — ตัวจัดสรรโควตาแบบ "หน้าต่างเลื่อน + คิดตาม credit"
   ------------------------------------------------------------
   ปัญหาของคิวเดิม (createQueue แบบเว้นจังหวะคงที่):
     1) ยิงได้ทีละ 1 คำขอเท่านั้น (serial) และต้องรอ "ช่วงห่างคงที่" (60000/limit ms) ทุกครั้ง
        เวลาจริงต่อคำขอ = ช่วงห่าง + เวลาตอบกลับของเครือข่าย (latency) ดังนั้นถ้า Finnhub ตั้ง
        60 คำขอ/นาที (ห่าง 1,000ms) แต่ latency 300ms จะยิงได้จริงแค่ ~46 คำขอ/นาที = ทิ้งโควตา
        ฟรี ๆ ไปเกือบ 25% ตลอดเวลา ยิ่ง latency สูง (มือถือ/เน็ตช้า) ยิ่งเสียโควตามากขึ้น
     2) นับทุกคำขอเป็น "1 หน่วย" เท่ากันหมด ทั้งที่ Twelve Data จำกัดเป็น **API credit ต่อนาที**
        และคำขอแบบ batch (หลายสัญลักษณ์ใน 1 คำขอ) เสีย credit เท่าจำนวนสัญลักษณ์ — โค้ดเดิมยิง
        batch ทีละ 30 สัญลักษณ์บนแผนฟรีที่มีแค่ 8 credit/นาที จึงโดน 429 "run out of API credits"
        แทบทุกก้อนระหว่างสแกน (เห็นเป็น "สแกนแล้วไม่เจอหุ้น/ค้าง" โดยไม่รู้สาเหตุ)
     3) ไม่มีเพดาน "ต่อวัน" เลย ทั้งที่แผนฟรี Twelve Data จำกัด 800 credit/วัน — พอโควตาวันหมด
        ทุกคำขอที่เหลือจะล้มเหลวทีละตัวแบบเงียบ ๆ แทนที่จะรู้ตัวแล้วสลับไปใช้ Finnhub แทน
     4) ไม่มีลำดับความสำคัญ งานเบื้องหลัง (สแกนพูลหลายพันตัว) แย่งคิวกับงานที่ผู้ใช้กดเองอยู่
        ตรงหน้า ทำให้กดดูกราฟหุ้นตัวเดียวต้องรอหลังคิวสแกนทั้งหมด

   ตัวจัดสรรใหม่แก้ครบทั้ง 4 ข้อ:
     • หน้าต่างเลื่อน 60 วินาที + นับ "credit" จริง → ยิงพร้อมกันได้ (concurrency) จนเต็มโควตานาที
       นั้นพอดี แล้วรอเฉพาะเท่าที่จำเป็น = ใช้โควตาได้เต็มเพดานโดยไม่ทะลุ
     • งานแต่ละชิ้นแจ้ง cost ของตัวเอง (batch 30 สัญลักษณ์ = 30 credit) → คุมได้ตรงตามที่ผู้ให้
       บริการคิดจริง
     • เพดานรายวันแยกต่อผู้ให้บริการ + ฟังก์ชันเช็คโควตาคงเหลือ ให้ตัวเลือกเส้นทาง (router)
       ใช้ตัดสินใจว่าจะส่งงานไปทางไหน
     • คิวมีลำดับความสำคัญ (priority) งานที่ผู้ใช้กดเองแซงงานเบื้องหลังเสมอ
   ============================================================ */
export const RATE_WINDOW_MS = 60000;
// เผื่อ margin กันการนับคลาดเคลื่อนระหว่างนาฬิกาเครื่องเรากับฝั่งผู้ให้บริการ — แต่ใช้เฉพาะกับ
// Plan ที่เพดานสูงเท่านั้น (SAFETY_MIN_LIMIT ขึ้นไป) เพราะถ้าเพดานเป็นเลขน้อย ๆ อย่างแผนฟรีของ
// Twelve Data (8 credit/นาที) การหัก 8% ทิ้งจะกลายเป็น "เสียไป 1 credit เต็ม ๆ จาก 8" = ทิ้ง
// โควตา 12.5% ซึ่งขัดกับเป้าหมายที่ต้องการใช้โควตาให้เต็ม — เพดานเล็กจึงยิงเต็มจำนวน แล้วอาศัย
// กลไกเบรกอัตโนมัติเมื่อเจอ 429 (ดู penalize) รับมือกรณีขอบ ๆ แทน
export const RATE_SAFETY = 0.92;
export const SAFETY_MIN_LIMIT = 12;
export function applySafety(limitPerMin) {
  const lim = Math.max(1, limitPerMin);
  return lim <= SAFETY_MIN_LIMIT ? Math.floor(lim) : Math.max(1, Math.floor(lim * RATE_SAFETY));
}
export const PRIORITY = { INTERACTIVE: 0, NORMAL: 5, BACKGROUND: 9 };

// ขยายจาก ApiError(QUOTA) เพื่อให้ isQuotaExhausted/isRateLimited/isAuthError ฯลฯ ครบชุดเดียวกัน
// ไม่ว่า error จะมาจากที่นี่ (เช็คโควตาก่อนยิงจริง) หรือจากชั้น tdRequest/fhRequest (provider
// ปฏิเสธคำขอตรง ๆ) — ผู้เรียกเช็คธงเดียวกันได้เสมอโดยไม่ต้องรู้ว่า error มาจากจุดไหน
export class QuotaExhaustedError extends ApiError {
  constructor(provider, scope) {
    const name = provider === "td" ? "Twelve Data" : "Finnhub";
    const message = `โควตา ${name} ${scope === "day" ? "รายวัน" : "รายนาที"} หมดแล้ว`;
    super(ApiErrorKind.QUOTA, { provider, detail: message });
    // ข้อความนี้เจาะจงกว่าข้อความกลางของ ApiErrorKind.QUOTA ใน apiError.js (ระบุ provider + ช่วง
    // เวลาที่หมดไปด้วย) จึงแทนที่ e.message ทันทีหลัง super() — ธง isQuotaExhausted/isRateLimited/
    // isAuthError ฯลฯ ที่ ApiError ตั้งไว้แล้วยังใช้ได้ตามปกติ ไม่กระทบ
    this.message = message;
    this.scope = scope;
  }
}

/* ------------------------------------------------------------
   แชร์หน้าต่างโควตาข้ามแท็บ
   ------------------------------------------------------------
   ตัวนับ "ใช้ไปกี่ครั้งวันนี้" อยู่ใน localStorage อยู่แล้วจึงแชร์ข้ามแท็บได้เอง แต่หน้าต่าง
   เลื่อน "ต่อนาที" เป็นของแต่ละแท็บ — เปิดแอปค้างไว้ 2 แท็บโดยใช้ API key เดียวกัน แต่ละแท็บ
   จะคิดว่าตัวเองมีโควตาเต็มจำนวน รวมกันแล้วยิงเกินเพดานเป็นเท่าตัว โดนปฏิเสธทั้งคู่
   แก้โดยบันทึก credit ที่ใช้ไปลง localStorage พร้อม id ของแท็บที่ใช้ แล้วให้ทุกแท็บนับรวม
   "credit ที่แท็บอื่นใช้ไป" เข้ากับของตัวเองก่อนตัดสินใจยิง

   เรื่อง atomicity: การเขียนเป็น read-modify-write (อ่าน array เดิม → push → เขียนกลับ) ถ้า
   สองแท็บทำพร้อมกันพอดี แท็บที่เขียนทีหลังจะ "ทับ" ของแท็บแรกที่เพิ่งเขียนไป (lost update) —
   localStorage เองไม่มี compare-and-swap ให้ ป้องกันด้วย Web Locks API (`navigator.locks`)
   ซึ่งเบราว์เซอร์สมัยใหม่ทุกตัวรองรับ (Chrome/Edge 69+, Firefox 96+, Safari 15.4+) เพื่อทำให้
   การอ่าน-แก้-เขียนเป็น atomic จริงข้ามแท็บ ถ้าเบราว์เซอร์ไหนไม่รองรับ (เช่น Safari เก่า, หรือ
   origin แบบ file://) จะถอยไปทำแบบเดิม (best-effort ไม่มี lock) โดยอัตโนมัติ — กลไก penalize
   เมื่อเจอ 429 ยังรับมือความคลาดเคลื่อนเล็กน้อยจากกรณีนี้ได้อยู่ดี ไม่ทำให้แอปพังหรือค้าง
   ------------------------------------------------------------ */
export const TAB_ID = Math.random().toString(36).slice(2, 10);
export const sharedWindowKey = (provider) => `rl-window-${provider}`;
export const hasWebLocks = typeof navigator !== "undefined" && !!navigator.locks && typeof navigator.locks.request === "function";

// รันฟังก์ชันภายใต้ lock ข้ามแท็บที่ชื่อ `name` (ถ้าเบราว์เซอร์รองรับ) — กันการชนกันของ
// read-modify-write ให้ atomic จริง ๆ ไม่ใช่แค่ "น่าจะไม่ชน" เหมือนก่อนหน้านี้
export function withCrossTabLock(name, fn) {
  if (!hasWebLocks) return fn(); // ถอยไปทำตรง ๆ โดยไม่มี lock (best-effort เหมือนเดิม)
  return navigator.locks.request(name, { mode: "exclusive" }, fn).catch((e) => {
    // AbortError จาก timeout/ignoreDuplicates หรือเหตุผลอื่นของเบราว์เซอร์ — อย่าให้การยิง API
    // ทั้งคิวค้างเพราะ lock มีปัญหา ถอยไปทำแบบไม่มี lock ครั้งนี้แทน ดีกว่าคำนวณโควตาไม่ได้เลย
    console.warn(`[Storage] ขอ lock "${name}" ไม่สำเร็จ ทำงานต่อแบบไม่มี lock ครั้งนี้:`, e?.message || e);
    return fn();
  });
}

export function readSharedWindow(provider) {
  try {
    const arr = JSON.parse(localStorage.getItem(sharedWindowKey(provider)) || "[]");
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.filter((e) => Array.isArray(e) && now - e[0] < RATE_WINDOW_MS);
  } catch { return []; }
}
// อ่าน-แก้-เขียนภายใต้ lock เดียวกันเสมอ (ชื่อ lock ผูกกับ provider ตรง ๆ) เพื่อไม่ให้แท็บอื่น
// ที่กำลัง append พร้อมกันมาทับกัน — ไม่ await ผลลัพธ์ของ caller (fire-and-forget) เพราะการยิง
// API จริงต้องไม่รอ lock บันทึกบัญชีให้เสร็จก่อน (เพียงแค่ต้อง "เผื่อเวลา" ไว้แล้ว ดูใน pump())
export function appendSharedWindow(provider, t, cost) {
  withCrossTabLock(`stock-dash-rl-${provider}`, async () => {
    try {
      const arr = readSharedWindow(provider);
      arr.push([t, cost, TAB_ID]);
      localStorage.setItem(sharedWindowKey(provider), JSON.stringify(arr));
    } catch { /* localStorage ใช้ไม่ได้ → ถอยไปใช้หน้าต่างในหน่วยความจำของแท็บนี้อย่างเดียว */ }
  }).catch(() => {});
}
// credit ที่ "แท็บอื่น" ใช้ไปในหน้าต่าง 60 วินาทีล่าสุด (ไม่นับของแท็บนี้ เพราะนับในหน่วยความจำแล้ว)
// ตัว pump ของคิวเรียกฟังก์ชันนี้ทุกงานในคิว จึงจำผลไว้สั้น ๆ กันการ parse JSON ซ้ำถี่เกินจำเป็น
export const foreignCache = {};
export const FOREIGN_CACHE_MS = 250;
export function foreignCredits(provider) {
  const now = Date.now();
  const hit = foreignCache[provider];
  if (hit && now - hit.t < FOREIGN_CACHE_MS) return hit.v;
  const v = readSharedWindow(provider).reduce((sum, e) => (e[2] === TAB_ID ? sum : sum + (e[1] || 0)), 0);
  foreignCache[provider] = { t: now, v };
  return v;
}
export function invalidateForeignCache(provider) { delete foreignCache[provider]; }
// แท็บอื่นเพิ่งยิงคำขอ → ล้างผลที่จำไว้ทันที ไม่ต้องรอครบ 250ms (event นี้ยิงเฉพาะเมื่อ
// "แท็บอื่น" เป็นคนเขียน localStorage เท่านั้น จึงไม่วนกลับมาหาตัวเอง)
try {
  window.addEventListener("storage", (ev) => {
    if (ev.key && ev.key.startsWith("rl-window-")) invalidateForeignCache(ev.key.slice(10));
  });
} catch { /* ไม่มี window (เช่นรันใน worker) ก็ข้ามไป */ }

export function createLimiter(provider, getLimitPerMin, getMaxConcurrent) {
  const spent = [];      // ประวัติ credit ที่ใช้ไปในหน้าต่าง 60 วินาทีล่าสุด [{t, cost}]
  const queue = [];      // งานที่รอคิวอยู่ เรียงตาม priority แล้วค่อยตามลำดับที่เข้ามา
  let active = 0;        // จำนวนคำขอที่กำลังวิ่งอยู่จริงในขณะนี้
  let seq = 0;
  let timer = null;

  const prune = (now) => { while (spent.length && now - spent[0].t >= RATE_WINDOW_MS) spent.shift(); };
  const ownCredits = () => spent.reduce((s, e) => s + e.cost, 0);
  // โควตาที่ "ใช้ไปแล้วจริง" = ของแท็บนี้ + ของแท็บอื่นที่เปิดอยู่พร้อมกัน
  const usedCredits = () => ownCredits() + foreignCredits(provider);
  const effectiveLimit = () => applySafety(getLimitPerMin());

  function wake(delay) {
    if (timer) return;
    timer = setTimeout(() => { timer = null; pump(); }, Math.max(15, delay));
  }

  function pump() {
    while (queue.length) {
      const now = Date.now();
      prune(now);
      if (active >= Math.max(1, getMaxConcurrent())) return; // เต็ม concurrency → รอให้งานเดิมจบก่อน
      const limit = effectiveLimit();
      const task = queue[0];
      // งานที่ cost ใหญ่กว่าเพดานนาทีเป็นไปไม่ได้อยู่แล้ว — หนีบไว้ที่เพดานเพื่อไม่ให้คิวตันถาวร
      const cost = Math.min(task.cost, limit);
      if (usedCredits() + cost > limit) {
        // รอจนกว่า credit ก้อนเก่าสุดจะหลุดออกจากหน้าต่าง 60 วินาที แล้วค่อยลองใหม่
        // ถ้าที่เต็มอยู่เป็นของแท็บอื่น (spent ของเราว่าง) ให้ poll ถี่ ๆ แทน — แท็บนั้นอาจถูก
        // ปิดไปเมื่อไรก็ได้ เราจะได้เข้าใช้โควตาต่อทันทีโดยไม่ต้องรอครบนาที
        wake(spent.length ? RATE_WINDOW_MS - (now - spent[0].t) + 25 : 500);
        return;
      }
      queue.shift();
      spent.push({ t: now, cost });
      appendSharedWindow(provider, now, cost);
      active += 1;
      Promise.resolve()
        .then(task.fn)
        .then(task.resolve, task.reject)
        .finally(() => { active -= 1; pump(); });
    }
  }

  const run = (fn, opts = {}) => {
    const cost = Math.max(1, Number(typeof opts === "number" ? opts : opts.cost) || 1);
    const priority = (typeof opts === "object" && opts.priority != null) ? opts.priority : PRIORITY.NORMAL;
    return new Promise((resolve, reject) => {
      const task = { fn, cost, priority, seq: seq++, resolve, reject };
      // แทรกตามลำดับความสำคัญ (เลขน้อย = สำคัญกว่า) งานที่ priority เท่ากันเรียงตามลำดับเข้าคิว
      let i = queue.length;
      while (i > 0 && queue[i - 1].priority > priority) i--;
      queue.splice(i, 0, task);
      pump();
    });
  };

  run.provider = provider;
  run.effectiveLimit = effectiveLimit;
  // เมื่อโดน 429 จริงจากผู้ให้บริการ = การประมาณของเราสูงเกินไปชั่วคราว (เช่น มีอีกแท็บของแอป
  // เปิดอยู่และใช้ key เดียวกัน หรือ Plan จริงต่ำกว่าที่ผู้ใช้กรอกไว้) — ยัด credit ปลอมเข้า
  // หน้าต่างเพื่อ "เบรก" ตัวเองอัตโนมัติ แล้วค่อยกลับมาเต็มสปีดเองเมื่อหน้าต่าง 60 วิ เลื่อนพ้นไป
  run.penalize = (credits = 1) => {
    const now = Date.now();
    for (let i = 0; i < credits; i++) spent.push({ t: now, cost: 1 });
    appendSharedWindow(provider, now, credits); // ให้แท็บอื่นเบรกตามด้วย เพราะโดนเพดานเดียวกัน
  };
  run.stats = () => {
    prune(Date.now());
    const limit = effectiveLimit();
    return { used: usedCredits(), limit, queued: queue.length, active, freeRatio: Math.max(0, (limit - usedCredits()) / limit) };
  };
  return run;
}

// เพดานของแต่ละผู้ให้บริการ — ปรับได้จากหน้าตั้งค่าให้ตรงกับ Plan ที่ผู้ใช้สมัครจริง
// (ค่าเริ่มต้น = แผนฟรีของแต่ละเจ้า) dailyLimit = 0 หมายถึง "ไม่จำกัด/ไม่ทราบ" จะไม่บล็อกอะไรเลย
export const QUOTA = {
  td: { perMin: 8, perDay: 800, maxConcurrent: 4 },   // Twelve Data แผนฟรี: 8 credit/นาที, 800 credit/วัน
  fh: { perMin: 60, perDay: 0, maxConcurrent: 8 },    // Finnhub แผนฟรี: 60 คำขอ/นาที, ไม่จำกัดรายวัน
};
export function setTdRateLimit(callsPerMinute) {
  const n = Number(callsPerMinute);
  if (Number.isFinite(n) && n > 0) QUOTA.td.perMin = n;
}
export function setFhRateLimit(callsPerMinute) {
  const n = Number(callsPerMinute);
  if (Number.isFinite(n) && n > 0) QUOTA.fh.perMin = n;
}
export function setTdDailyLimit(creditsPerDay) {
  const n = Number(creditsPerDay);
  if (Number.isFinite(n) && n >= 0) QUOTA.td.perDay = n;
}
export function setFhDailyLimit(callsPerDay) {
  const n = Number(callsPerDay);
  if (Number.isFinite(n) && n >= 0) QUOTA.fh.perDay = n;
}

export const tdQueue = createLimiter("td", () => QUOTA.td.perMin, () => QUOTA.td.maxConcurrent);
export const fhQueue = createLimiter("fh", () => QUOTA.fh.perMin, () => QUOTA.fh.maxConcurrent);
export const providerQueue = { td: tdQueue, fh: fhQueue };

// จำนวนสัญลักษณ์สูงสุดที่ควรรวมเป็น batch เดียวของ Twelve Data — ต้องไม่เกิน "เพดาน credit ต่อ
// นาที" ของแผนที่ใช้อยู่ ไม่งั้นคำขอก้อนนั้นจะทะลุโควตานาทีเดียวและโดน 429 ทั้งก้อนเสมอ
// (นี่คือสาเหตุที่การสแกนด้วยก้อนละ 30 ตัวบนแผนฟรี 8 credit/นาที ล้มเหลวมาตลอด)
export const TD_BATCH_HARD_CAP = 120; // เพดานจากฝั่ง Twelve Data เอง (และกัน URL ยาวเกินไป)
export function tdBatchSize() {
  return Math.max(1, Math.min(TD_BATCH_HARD_CAP, tdQueue.effectiveLimit()));
}

/* ---------------- โควตารายวัน: ตรวจก่อนใช้ ---------------- */
// getApiCallsToday/bumpApiCalls ประกาศอยู่ด้านล่าง (function declaration จึงถูก hoist มาใช้ได้)
export function dailyRemaining(provider) {
  const limit = QUOTA[provider]?.perDay || 0;
  if (!limit) return Infinity; // ไม่ได้ตั้งเพดานรายวันไว้ = ไม่จำกัด
  return Math.max(0, limit - getApiCallsToday(provider));
}
export function hasDailyBudget(provider, cost = 1) {
  return dailyRemaining(provider) >= cost;
}
export function assertDailyBudget(provider, cost = 1) {
  if (!hasDailyBudget(provider, cost)) throw new QuotaExhaustedError(provider, "day");
}
// "คะแนนความว่าง" ของผู้ให้บริการ — ใช้ตัดสินใจว่างานที่ทำได้ทั้งสองทางควรไปทางไหน
// รวมทั้งโควตานาที (ว่างแค่ไหนตอนนี้) และโควตาวัน (เหลือกี่ % ของทั้งวัน) เข้าด้วยกัน
export function providerHeadroom(provider, cost = 1) {
  if (!hasDailyBudget(provider, cost)) return -1;
  const s = providerQueue[provider].stats();
  const limitDay = QUOTA[provider]?.perDay || 0;
  const dayRatio = limitDay ? dailyRemaining(provider) / limitDay : 1;
  const queuePenalty = 1 / (1 + s.queued / Math.max(1, s.limit)); // คิวยาว = ว่างน้อย
  return (s.freeRatio * 0.5 + dayRatio * 0.5) * queuePenalty;
}

// สรุปสถานะโควตาไว้ให้ UI แสดงผล (ดูแถบโควตาบนหัวแอป)
export function getQuotaSnapshot() {
  const build = (p) => {
    const s = providerQueue[p].stats();
    return {
      provider: p,
      minuteUsed: s.used,
      minuteLimit: s.limit,
      queued: s.queued,
      active: s.active,
      dayUsed: getApiCallsToday(p),
      dayLimit: QUOTA[p].perDay || 0,
    };
  };
  return { td: build("td"), fh: build("fh") };
}

// เช็ค error ชั่วคราวของ Finnhub (โดน rate limit ต่อนาที/ต่อวินาทีชนโควตา) แบบเดียวกับ
// isTransientTdError — เดิม Finnhub ไม่มีการ retry เลย พอโดน 429 ระหว่างสแกนหุ้นจำนวนมาก
// (fundamentals/profile/news ของหุ้นที่ผ่านเกณฑ์เทคนิคแล้ว) จะเสียโอกาสไปเฉย ๆ ทั้งที่หุ้นตัวนั้น
// ผ่านการสแกนทางเทคนิค (ซึ่งเปลืองโควตา Twelve Data ไปแล้ว) มาก่อนแล้ว — การไม่ retry จึงเท่ากับ
// ทิ้งงานที่ลงทุนโควตาไปแล้วครึ่งทาง ทำให้ภาพรวมใช้โควตาทั้งสอง API ไม่คุ้มค่า
export function isTransientFhError(res) {
  return res.status === 429 || res.status === 403;
}

/* ---------------- storage helpers ---------------- */
export async function loadStore(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
}
export async function saveStore(key, value) {
  // ข้อมูลผู้ใช้ (watchlist, API keys, พอร์ต) สำคัญกว่าแคชเสมอ — ถ้าพื้นที่เต็มให้กวาดแคชทิ้ง
  // แล้วเขียนใหม่ ไม่ใช่ปล่อยให้การตั้งค่าของผู้ใช้หายไปเพราะแคชกินพื้นที่จนหมด
  safeSetItem(key, JSON.stringify(value));
}

/* ---------------- exchange rate helper (USD -> THB) ---------------- */
export async function fetchUsdThbRate() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error("rate fetch failed");
    const data = await res.json();
    const rate = data?.rates?.THB;
    if (typeof rate === "number" && rate > 0) {
      return { rate, updatedAt: data.time_last_update_utc || new Date().toISOString() };
    }
    throw new Error("invalid rate payload");
  } catch (e) {
    console.error("exchange rate fetch failed", e);
    return null;
  }
}

/* ---------------- AI transaction image import (Google Gemini Vision) ---------------- */
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
export const PORTFOLIO_EXTRACT_PROMPT = [
  "คุณกำลังดูภาพหน้าจอ (screenshot) ของการทำรายการซื้อขายหุ้น (เช่น ใบยืนยันคำสั่งซื้อ/ขาย, ตารางประวัติการทำรายการ (transaction/activity history), หรือหน้าจอแอปโบรกเกอร์) ให้วิเคราะห์ว่าภาพนี้มีการทำรายการซื้อ/ขายหุ้นอะไรบ้าง แล้วดึงข้อมูลออกมาเป็น JSON array เท่านั้น",
  "ห้ามใส่คำอธิบาย ห้ามใส่ markdown code fence ห้ามมีข้อความอื่นใดนอกเหนือจาก JSON array",
  "",
  "สำหรับการทำรายการแต่ละรายการในภาพ ให้สร้าง object ที่มี field ดังนี้:",
  '- \"symbol\": ticker หุ้นแบบตัวพิมพ์ใหญ่ (เช่น \"AAPL\") ตัดคำนำหน้า/ต่อท้ายของตลาดหรือสกุลเงินออก',
  '- \"action\": \"BUY\" หากเป็นการซื้อ/เพิ่มหุ้น หรือ \"SELL\" หากเป็นการขาย/ตัดขายหุ้น ให้พิจารณาจากคำในภาพ (เช่น Buy, Bought, ซื้อ, Sell, Sold, ขาย, สีเขียว/แดงของยอดเงิน) หากไม่แน่ใจจริง ๆ ให้ใส่ \"BUY\"',
  '- \"shares\": จำนวนหุ้น/หน่วยที่ทำรายการ (ตัวเลข ไม่ใช่ string) รองรับทศนิยม ถ้าภาพไม่มีคอลัมน์จำนวนหุ้นให้ระบุเลย ให้ใส่ค่าเป็น null (อย่าข้ามทั้งรายการ ให้ผู้ใช้กรอกจำนวนหุ้นเองภายหลัง)',
  '- \"price\": ราคาต่อหุ้นที่ทำรายการ ณ ตอนนั้น เป็นตัวเลข (ไม่ใช่มูลค่ารวม) ถ้าคำนวณไม่ได้ให้ใส่ null',
  '- \"amount\": มูลค่ารวมเป็นเงินของรายการนั้น (จำนวนหุ้น x ราคา) เป็นตัวเลขบวกเสมอ (ไม่ต้องสนใจเครื่องหมาย +/- หรือสีที่แสดงในภาพ) ถ้าภาพไม่มีให้ใส่ null',
  '- \"date\": วันที่ทำรายการในรูปแบบ \"YYYY-MM-DD\" หากอ่านได้จากภาพ มิฉะนั้นให้ใส่ null หากภาพแสดงวันที่เป็นตัวเลขคั่นด้วย \"/\" (เช่น 09/08/2026) ให้ตีความเป็น DD/MM/YYYY (วัน/เดือน/ปี) เสมอ ไม่ใช่ MM/DD/YYYY แบบสหรัฐฯ เว้นแต่จะมีชื่อเดือนเป็นตัวอักษรระบุชัดเจนในภาพ หรือค่าตัวแรกเกิน 12 (ซึ่งเป็นไปได้แค่รูปแบบวัน/เดือน) ให้ยึดตามนั้น',
  "",
  "กฎการอ่านข้อมูลและการคำนวณเมื่อข้อมูลไม่ได้แสดงตรง ๆ:",
  '- บางตารางจะแสดงรายการเป็นข้อความประโยคในคอลัมน์เดียว เช่น \"Bought Oklo Inc. OKLO\" หรือ \"Sold CoreWeave, Inc. CRWV\" ให้ดึงคำว่า Bought/Sold (หรือซื้อ/ขาย) มาระบุ action และดึง ticker ที่อยู่ท้ายประโยคนั้นมาเป็น symbol',
  '- ถ้าตารางมีคอลัมน์ \"Type\"/\"ประเภท\" ให้พิจารณาเฉพาะแถวที่เป็นการซื้อขายหุ้นจริง (เช่น Trade, Order, ซื้อ, ขาย) เท่านั้น ข้ามแถวที่เป็น Fees, Interest, Dividend, Transfer, Deposit, Withdraw, ค่าธรรมเนียม, ดอกเบี้ย หรือรายการที่ไม่ใช่การซื้อขายหุ้น/ETF จริง',
  "- ถ้าภาพแสดง \"มูลค่ารวม\"/\"Amount\" ของรายการแทนที่จะเป็นราคาต่อหุ้น และมีจำนวนหุ้นให้เห็นด้วย ให้คำนวณ price = มูลค่ารวม / จำนวนหุ้น",
  "- อย่าเดาตัวเลขที่มองไม่เห็นในภาพ ใช้เฉพาะตัวเลขที่อ่านได้หรือคำนวณได้จากตัวเลขที่อ่านได้เท่านั้น",
  "- ถ้าภาพเป็นภาพรวมพอร์ต (snapshot) ที่ไม่ได้ระบุว่าเป็นรายการซื้อหรือขาย ให้ถือว่าแต่ละรายการเป็น \"BUY\" ของจำนวนหุ้นที่ถืออยู่ ด้วยราคาต้นทุนเฉลี่ยที่แสดง (หรือคำนวณจากกำไร/ขาดทุนถ้ามี)",
  "- ข้ามรายการที่ไม่ใช่หุ้น/ETF จริง (เช่น เงินสด, ยอดรวมทั้งพอร์ต)",
  "- ห้ามข้ามรายการทั้งที่ระบุ symbol และ action ได้ชัดเจน แม้ว่าจะหาจำนวนหุ้นหรือราคาไม่ได้ก็ตาม",
  "- สำคัญมาก: ต้องอ่านและดึงข้อมูล \"ทุกแถว\" ที่เป็นการซื้อขายหุ้นซึ่งปรากฏอยู่ในภาพ ไล่จากบนลงล่างจนถึงแถวสุดท้ายที่มองเห็นในภาพ ห้ามหยุดหลังจากดึงมาได้แค่แถวแรกหรือไม่กี่แถวเด็ดขาด นับจำนวนแถวที่เป็นการซื้อขายหุ้นในภาพก่อน แล้วตรวจสอบว่า array ที่ตอบมีจำนวน object เท่ากับที่นับได้",
  "",
  "ตัวอย่างรูปแบบผลลัพธ์ที่ถูกต้อง (ต้องเป็น JSON array ล้วน ๆ เท่านั้น):",
  '[{"symbol":"AAPL","action":"BUY","shares":10,"price":150.25,"amount":1502.5,"date":"2026-03-14"},{"symbol":"NVDA","action":"SELL","shares":null,"price":null,"amount":41.21,"date":"2026-09-09"}]'
].join("\n");

export async function extractPortfolioFromImage(base64Data, mediaType, apiKey) {
  // ส่ง key ทาง header (x-goog-api-key) แทน query string `?key=` — URL ของคำขอจึงไม่มี key ติดไปอยู่ใน
  // DevTools > Network / ประวัติ / log ของตัวกลางใด ๆ (เป็นวิธีเดียวกับ SDK เว็บทางการของ Google)
  const res = await secureFetch(GEMINI_API_BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Data } },
            { text: PORTFOLIO_EXTRACT_PROMPT }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 32768,
        temperature: 0,
        thinkingConfig: {
          // gemini-3.x ใช้ thinkingLevel ไม่ใช่ thinkingBudget (แบบ gemini-2.5) — ส่ง thinkingBudget
          // ไปจะโดน 400 Request contains an invalid argument ทันที เพราะพารามิเตอร์ไม่ตรงกับรุ่นโมเดล
          // "low" คือระดับต่ำสุดที่ใช้ได้โดยไม่ต้องจัดการ thought signature เพิ่ม (ต่างจาก "minimal")
          thinkingLevel: "low"
        },
        // บังคับให้ Gemini ตอบเป็น JSON ล้วน ๆ ผ่าน structured output ของ API โดยตรง
        // แทนที่จะพึ่งแค่คำสั่งในพรอมต์ ป้องกันกรณีโมเดลแถมคำอธิบายหรือ markdown มาด้วย
        // จนทำให้ parse เป็น JSON ไม่ได้
        // หมายเหตุ: เคยลองใส่ responseSchema (ARRAY of OBJECT) เพิ่มเข้าไปด้วย แต่พบว่าโมเดลจะหยุด
        // สร้างรายการหลังจากได้แค่ 1 รายการแรกทุกครั้ง (เพราะ schema ไม่ได้กำหนด minItems ไว้ อาเรย์ 1
        // รายการก็ถือว่า "valid" ตาม schema แล้ว โมเดลเลยหยุดเร็วกว่าที่ควร) จึงตัด responseSchema ออก
        // เหลือแค่บังคับ mime type เป็น JSON พอ ให้พรอมต์ (ข้างล่าง) เป็นตัวกำหนดว่าต้องดึงให้ครบทุกแถว
        responseMimeType: "application/json"
      }
    })
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody?.error?.message || "";
    } catch {}
    throw new Error(redactSecrets(`Gemini API error (${res.status}) ${detail}`.trim()));
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  // ตัด part ที่เป็น "thought" (ความคิดระหว่างประมวลผล) ออก เอาเฉพาะข้อความคำตอบจริง
  const textParts = parts.filter((p) => typeof p.text === "string" && p.text.trim() && !p.thought);
  const raw0 = textParts.map((p) => p.text).join("\n").trim();

  if (!raw0) {
    const finishReason = candidate?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new Error("Gemini ตอบไม่ครบเพราะยาวเกินไป ลองใช้รูปที่มีรายการน้อยลงหรือครอปเฉพาะส่วนที่ต้องการ");
    }
    throw new Error("ไม่ได้รับข้อความตอบกลับจาก Gemini");
  }

  let raw = raw0.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const rawSnippet = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // เผื่อ Gemini แถมข้อความอื่นมาด้วยนอกเหนือจาก JSON array ให้ลองตัดเอาเฉพาะช่วง [ ... ] ออกมา
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1));
      } catch (e2) {
        throw new Error(`ไม่สามารถแปลงผลลัพธ์เป็น JSON ได้ (${e2.message}) — สิ่งที่ Gemini ตอบกลับมา: "${rawSnippet}"`);
      }
    } else {
      throw new Error(`ไม่สามารถแปลงผลลัพธ์เป็น JSON ได้ — สิ่งที่ Gemini ตอบกลับมา: "${rawSnippet}"`);
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error("รูปแบบข้อมูลที่ได้ไม่ถูกต้อง");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const rows = parsed
    .map((r) => ({
      symbol: String(r.symbol || "").toUpperCase().trim(),
      action: String(r.action || "BUY").toUpperCase().trim() === "SELL" ? "SELL" : "BUY",
      shares: r.shares === null || r.shares === undefined || r.shares === "" ? null : parseFloat(r.shares),
      price: r.price === null || r.price === undefined || r.price === "" ? null : parseFloat(r.price),
      amount: r.amount === null || r.amount === undefined || r.amount === "" ? null : Math.abs(parseFloat(r.amount)),
      date: (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())) ? r.date.trim() : todayStr
    }))
    .map((r) => ({
      ...r,
      shares: Number.isFinite(r.shares) && r.shares > 0 ? r.shares : null,
      price: Number.isFinite(r.price) && r.price > 0 ? r.price : null,
      amount: Number.isFinite(r.amount) && r.amount > 0 ? r.amount : null
    }))
    .filter((r) => r.symbol);

  // finishReason "MAX_TOKENS" ที่นี่หมายความว่า Gemini ถูกตัดจบก่อนอ่านครบทุกแถวในภาพ
  // (structured output จะปิด JSON array ให้ถูกไวยากรณ์เสมอ ต่อให้ถูกตัดจบ จึง parse ผ่านได้
  // ทั้งที่ข้อมูลไม่ครบ — ต้องเช็ค finishReason แยกต่างหากถึงจะรู้)
  const truncated = candidate?.finishReason === "MAX_TOKENS";
  return { rows, truncated };
}

