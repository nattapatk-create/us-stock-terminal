import { redactError } from "../utils/redact.js";
import { ApiError, ApiErrorKind } from "./apiError.js";

/* ------------------------------------------------------------
   fetch ที่ล้าง API key ออกจาก error ก่อนโยนต่อ + จัดหมวดเป็น ApiError(NETWORK)
   ------------------------------------------------------------
   ตั้งแต่งานที่ 5 คำขอไปยัง Twelve Data / Finnhub ส่ง key ผ่าน HTTP header เป็นค่าเริ่มต้นแล้ว (ดู
   src/api/authRequest.js) จึงไม่มี key อยู่ใน URL ตามปกติ แต่ยังมีเส้นทาง fallback ที่ใส่ key กลับ
   เป็น query string ถ้า header ใช้ไม่ได้จริง — ถ้าเบราว์เซอร์/polyfill ใดแนบ URL มาในข้อความ error
   (เช่น "Failed to fetch https://...&apikey=xxxx") ข้อความนั้นจะไหลต่อไปถึง console.warn /
   console.error และถูกแสดงใน UI ฟังก์ชันนี้จึงเป็นจุดผ่านเดียวของคำขอที่มี key ทุกเส้น (ทั้งสองโหมด)
   เพื่อให้ redact ที่ต้นทางครั้งเดียวไม่ว่า key จะอยู่ใน header หรือ query

   งานวันนี้ (ปรับปรุง Error Handling): fetch() เองจะ reject ก็ต่อเมื่อยิงคำขอไม่สำเร็จในระดับ
   เครือข่ายเท่านั้น (เน็ตล่ม, DNS พัง, ถูก CORS บล็อกจน browser ไม่ยอมส่ง request จริง ๆ) — ไม่ใช่
   ตอบกลับมาเป็น HTTP error status (401/429/5xx ฯลฯ ยังถือว่า fetch "สำเร็จ" เสมอ เพียงแต่
   response.ok เป็น false) ดังนั้น error ทุกตัวที่ผ่าน catch นี้จึงจัดเป็น NETWORK ได้ทันทีอย่าง
   ไม่กำกวม ส่วนการแยกประเภทจาก HTTP status/response body (rate limit, auth, server, parse) ทำใน
   ชั้นถัดไปที่รู้ context ของ provider แล้ว (ดู tdRequest/fhRequest ใน priceSeries.js)
   ------------------------------------------------------------ */
export async function secureFetch(input, init, provider = null) {
  try {
    return await fetch(input, init);
  } catch (e) {
    const clean = redactError(e);
    throw new ApiError(ApiErrorKind.NETWORK, { provider, cause: clean, detail: clean?.message });
  }
}
