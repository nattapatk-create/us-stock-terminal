import { redactError } from "../utils/redact.js";

/* ------------------------------------------------------------
   fetch ที่ล้าง API key ออกจาก error ก่อนโยนต่อ
   ------------------------------------------------------------
   Twelve Data / Finnhub รับ key ผ่าน query string ทำให้ URL ของคำขอมี key อยู่ในตัว — ถ้าเบราว์เซอร์/
   polyfill ใดแนบ URL มาในข้อความ error (เช่น "Failed to fetch https://...&apikey=xxxx") ข้อความนั้นจะไหลต่อไป
   ถึง console.warn / console.error และถูกแสดงใน UI (`error: e.message`) ฟังก์ชันนี้จึงเป็นจุดผ่านเดียวของ
   คำขอที่มี key ทุกเส้น เพื่อให้ redact ที่ต้นทางครั้งเดียว
   ------------------------------------------------------------ */
export async function secureFetch(input, init) {
  try {
    return await fetch(input, init);
  } catch (e) {
    throw redactError(e);
  }
}
