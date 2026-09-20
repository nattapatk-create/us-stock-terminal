/* ============================================================
   ApiError — คลาส error กลางสำหรับทุกคำขอไปยัง Twelve Data / Finnhub
   ------------------------------------------------------------
   ปัญหาเดิม: แต่ละจุดที่ยิง API โยน `new Error(text)` ธรรมดา บางจุดใช้ข้อความดิบจาก
   provider ตรง ๆ (data.message ของ Twelve Data, data.error ของ Finnhub) บางจุดคือ
   `TypeError: Failed to fetch` ของเบราว์เซอร์ — UI (เช่น TickerCard, SectorRotationView,
   SP500HeatmapView) แสดง e.message ตรง ๆ ให้ผู้ใช้เห็น ทำให้:
     1) ผู้ใช้เห็นข้อความภาษาอังกฤษดิบ ๆ ที่ไม่รู้ว่าต้องทำอะไรต่อ (network error ปนกับ
        rate limit ปนกับ key ผิด ปนกับเซิร์ฟเวอร์ล่ม แยกไม่ออก)
     2) โค้ดผู้เรียกต้อง parse ข้อความ error เป็นภาษาอังกฤษเพื่อเดาว่าควร retry / fallback
        ไป provider อื่น / หยุดทั้ง batch หรือไม่ (เดิมมีแค่ isQuotaExhausted ตัวเดียวจาก
        QuotaExhaustedError ที่คิดมาแบบนี้ — ที่เหลือไม่มี)

   ApiError รวมทุกเส้นทาง error ที่เป็นไปได้จากการเรียก API ไว้เป็นหมวดหมู่เดียวกัน พร้อม
   ข้อความที่ผู้ใช้ทั่วไปอ่านแล้วเข้าใจและรู้ว่าควรทำอะไรต่อเป็นค่าเริ่มต้นของ e.message เสมอ
   (ข้อความดิบจาก provider เก็บแยกไว้ที่ e.detail สำหรับ debug/log เท่านั้น ไม่โชว์ผู้ใช้ตรง ๆ)
   ============================================================ */

export const ApiErrorKind = {
  NETWORK: "network",         // fetch() reject ก่อนได้ response กลับมาเลย (เน็ตล่ม / CORS / DNS)
  RATE_LIMIT: "rate_limit",   // HTTP 429 หรือ payload ที่ provider รายงานว่าชนโควตาต่อนาที
  AUTH: "auth",               // HTTP 401 (และ 403 ของ Twelve Data) หรือข้อความยืนยันว่า key ผิด/หมดสิทธิ์
  SERVER: "server",           // HTTP 5xx — ปัญหาฝั่ง provider ไม่ใช่ของเรา
  PARSE: "parse",             // response ตอบกลับมาแล้วแต่ body ไม่ใช่ JSON ที่ถูกต้อง
  QUOTA: "quota",             // โควตารายวันของแอปเองหมด (เช็คก่อนยิงจริงด้วยซ้ำ ไม่ต้องรอ provider ปฏิเสธ)
  UNKNOWN: "unknown",         // สถานะ/รูปแบบข้อมูลที่เหลือทั้งหมดที่ไม่เข้าเกณฑ์ข้างต้น
};

const FRIENDLY_MESSAGE = {
  [ApiErrorKind.NETWORK]: "เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง",
  [ApiErrorKind.RATE_LIMIT]: "มีการเรียกข้อมูลถี่เกินไปในตอนนี้ กรุณารอสักครู่แล้วลองใหม่",
  [ApiErrorKind.AUTH]: "API key ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบ API key ในหน้าตั้งค่า (⚙)",
  [ApiErrorKind.SERVER]: "เซิร์ฟเวอร์ของผู้ให้บริการข้อมูลขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง",
  [ApiErrorKind.PARSE]: "ได้รับข้อมูลจากเซิร์ฟเวอร์ในรูปแบบที่ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
  [ApiErrorKind.QUOTA]: "โควตาการเรียกข้อมูลวันนี้หมดแล้ว กรุณาลองใหม่พรุ่งนี้ หรือปรับ Plan ในหน้าตั้งค่า",
  [ApiErrorKind.UNKNOWN]: "เกิดข้อผิดพลาดที่ไม่คาดคิดระหว่างดึงข้อมูล กรุณาลองใหม่อีกครั้ง",
};

const PROVIDER_LABEL = { td: "Twelve Data", fh: "Finnhub" };

export class ApiError extends Error {
  /**
   * @param {string} kind - ค่าใน ApiErrorKind
   * @param {object} [opts]
   * @param {"td"|"fh"|null} [opts.provider]
   * @param {number|null} [opts.status] - HTTP status code ถ้ามี
   * @param {string|null} [opts.detail] - ข้อความดิบจาก provider/ระบบ เก็บไว้ debug เท่านั้น
   * @param {Error} [opts.cause] - error ต้นทาง (เช่น TypeError จาก fetch หรือ SyntaxError จาก JSON.parse)
   */
  constructor(kind, { provider = null, status = null, detail = null, cause } = {}) {
    const base = FRIENDLY_MESSAGE[kind] || FRIENDLY_MESSAGE[ApiErrorKind.UNKNOWN];
    const label = PROVIDER_LABEL[provider] || null;
    super(label ? `${base} (${label})` : base);
    this.name = "ApiError";
    this.kind = kind;
    this.provider = provider;
    this.status = status;
    this.detail = detail;
    if (cause !== undefined) this.cause = cause;

    // ธงสถานะที่โค้ดผู้เรียกเช็คได้ตรง ๆ โดยไม่ต้อง parse ข้อความเอง
    this.isNetworkError = kind === ApiErrorKind.NETWORK;
    this.isRateLimited = kind === ApiErrorKind.RATE_LIMIT;
    this.isAuthError = kind === ApiErrorKind.AUTH;
    this.isServerError = kind === ApiErrorKind.SERVER;
    this.isParseError = kind === ApiErrorKind.PARSE;
    this.isQuotaExhausted = kind === ApiErrorKind.QUOTA;
  }
}

// ใช้ log/debug เท่านั้น — ไม่โชว์ผู้ใช้ตรง ๆ (คง e.message ที่เป็นข้อความเข้าใจง่ายไว้เป็นค่าที่โชว์)
export function describeApiErrorForLog(e) {
  if (!(e instanceof ApiError)) return e?.message || String(e);
  const parts = [`[${e.kind}]`];
  if (e.provider) parts.push(PROVIDER_LABEL[e.provider] || e.provider);
  if (e.status != null) parts.push(`HTTP ${e.status}`);
  if (e.detail) parts.push(`- ${e.detail}`);
  return parts.join(" ");
}
