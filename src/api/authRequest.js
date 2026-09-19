/* ------------------------------------------------------------
   งานที่ 5: ย้าย API key ออกจาก URL query string ไปเป็น HTTP header
   ------------------------------------------------------------
   ยืนยันจากเอกสารทางการแล้วว่าทั้งสองเจ้ารองรับการส่ง key ผ่าน header แทน query param และ
   ตั้งใจให้เรียกจาก client (เบราว์เซอร์) ได้ตรง ๆ:
     - Twelve Data: header `Authorization: apikey <key>` (ทางเลือกแทน `?apikey=`)
       https://twelvedata.com/docs — "Authentication"
     - Finnhub:     header `X-Finnhub-Token: <key>` (ทางเลือกแทน `?token=`)
       https://finnhub.io/docs/api/authentication — "All REST API endpoints require an API
       key. Use it either as a query parameter or as a header."

   ข้อจำกัดที่ยังตรวจสอบไม่ได้ 100% จากในนี้: เอกสารไม่ได้ยืนยันชัดเจนว่า CORS preflight ของทั้งสอง
   บริการตอบ `Access-Control-Allow-Headers` ครอบคลุม header เหล่านี้จากทุก origin หรือไม่ (แซนด์บ็อกซ์
   นี้ไม่มีเครือข่ายให้ทดสอบยิงจริง) ถ้า preflight ถูกปฏิเสธ เบราว์เซอร์จะไม่ยิง GET จริงเลยและรายงาน
   เป็น `TypeError: Failed to fetch` เหมือนเน็ตล่ม แยกไม่ออกจากโค้ดฝั่งนี้ 100%
   เพื่อไม่ให้แอปพังทั้งฟีเจอร์ราคาหุ้นเงียบ ๆ ถ้าสมมติฐานข้างบนผิด (หรือผู้ให้บริการเปลี่ยนนโยบาย
   ในอนาคต) ตัวช่วยด้านล่างนี้จะ "ลองใช้ header ก่อนเสมอ" แล้ว fallback กลับไปที่ query string
   อัตโนมัติเฉพาะตอนที่คำขอด้วย header ล้มเหลวระดับเครือข่าย (ไม่ใช่ค่า response ปกติอย่าง 401/429)
   และจำผลไว้ในหน่วยความจำของแท็บนี้ (ไม่ persist ข้ามการเปิดแอปใหม่ — เจตนา เผื่อผู้ให้บริการแก้ไขแล้ว)
   เพื่อไม่ต้อง fallback ซ้ำทุกคำขอ นี่คือ "backend proxy" ทางเลือกที่ถูกกว่าตามที่งานนี้ให้พิจารณา:
   proxy จะซ่อน key ได้เมื่อ key เป็นของเจ้าของแอป ไม่ใช่โมเดล "ผู้ใช้ใส่ key เอง" ของแอปนี้ (ดูเหตุผล
   เต็มใน docs/API_KEY_SECURITY.md) จึงเลือกวิธี header + fallback นี้แทน
   ------------------------------------------------------------ */
import { secureFetch } from "./secureFetch.js";

// null = ยังไม่เคยยิงคำขอสำเร็จ (ยังไม่รู้), true = header ใช้ได้จริงแล้ว, false = ต้อง fallback เป็น query
const headerAuthSupported = { td: null, fh: null };

// ใช้เฉพาะใน tests เพื่อรีเซ็ตสถานะที่จำไว้ระหว่างเคสทดสอบ
export function __resetHeaderAuthProbeForTests() {
  headerAuthSupported.td = null;
  headerAuthSupported.fh = null;
}

async function requestWithHeaderFallback(provider, buildHeaderReq, buildQueryReq) {
  if (headerAuthSupported[provider] !== false) {
    try {
      const { url, init } = buildHeaderReq();
      const res = await secureFetch(url, init);
      headerAuthSupported[provider] = true;
      return res;
    } catch (e) {
      // เคยยืนยันแล้วว่า header ใช้ได้จริง (ยิงสำเร็จมาก่อนหน้านี้) → ครั้งนี้คือ error จริง (เน็ตล่ม
      // ฯลฯ) ไม่ใช่ปัญหา CORS ของ header จึงไม่ fallback ซ้ำ ปล่อยให้ error เดิมไหลต่อ
      if (headerAuthSupported[provider] === true) throw e;
      headerAuthSupported[provider] = false;
    }
  }
  const { url, init } = buildQueryReq();
  return secureFetch(url, init);
}

export function tdAuthedFetch(buildHeaderReq, buildQueryReq) {
  return requestWithHeaderFallback("td", buildHeaderReq, buildQueryReq);
}
export function fhAuthedFetch(buildHeaderReq, buildQueryReq) {
  return requestWithHeaderFallback("fh", buildHeaderReq, buildQueryReq);
}

/* ---------- ตัวสร้าง {url, init} ให้ baseUrl เดียวกันแตกเป็นสองแบบ (header / query) ---------- */
export function tdKeyRequest(baseUrl, tdKey, useHeader) {
  return useHeader
    ? { url: baseUrl, init: { headers: { Authorization: `apikey ${tdKey}` } } }
    : { url: `${baseUrl}&apikey=${encodeURIComponent(tdKey)}`, init: undefined };
}
export function fhKeyRequest(baseUrl, fhKey, useHeader) {
  return useHeader
    ? { url: baseUrl, init: { headers: { "X-Finnhub-Token": fhKey } } }
    : { url: `${baseUrl}&token=${encodeURIComponent(fhKey)}`, init: undefined };
}

// คู่ builder (header/query) จาก baseUrl เดียว — ผู้เรียกส่งเข้า tdRequest/fhRequest ตรง ๆ
export function tdRequestPair(baseUrl, tdKey) {
  return {
    header: () => tdKeyRequest(baseUrl, tdKey, true),
    query: () => tdKeyRequest(baseUrl, tdKey, false),
  };
}
export function fhRequestPair(baseUrl, fhKey) {
  return {
    header: () => fhKeyRequest(baseUrl, fhKey, true),
    query: () => fhKeyRequest(baseUrl, fhKey, false),
  };
}
