import { redactError } from "../utils/redact.js";

/* ------------------------------------------------------------
   fetch ที่ล้าง API key ออกจาก error ก่อนโยนต่อ
   ------------------------------------------------------------
   ตั้งแต่งานที่ 5 คำขอไปยัง Twelve Data / Finnhub ส่ง key ผ่าน HTTP header เป็นค่าเริ่มต้นแล้ว (ดู
   src/api/authRequest.js) จึงไม่มี key อยู่ใน URL ตามปกติ แต่ยังมีเส้นทาง fallback ที่ใส่ key กลับ
   เป็น query string ถ้า header ใช้ไม่ได้จริง — ถ้าเบราว์เซอร์/polyfill ใดแนบ URL มาในข้อความ error
   (เช่น "Failed to fetch https://...&apikey=xxxx") ข้อความนั้นจะไหลต่อไปถึง console.warn /
   console.error และถูกแสดงใน UI (`error: e.message`) ฟังก์ชันนี้จึงเป็นจุดผ่านเดียวของคำขอที่มี key
   ทุกเส้น (ทั้งสองโหมด) เพื่อให้ redact ที่ต้นทางครั้งเดียวไม่ว่า key จะอยู่ใน header หรือ query
   ------------------------------------------------------------ */
export async function secureFetch(input, init) {
  try {
    return await fetch(input, init);
  } catch (e) {
    throw redactError(e);
  }
}
