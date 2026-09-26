# การจัดการ API Key

แอปนี้เป็นเว็บ static (GitHub Pages) ที่ผู้ใช้ใส่ API key ของตัวเอง (Twelve Data / Finnhub / Gemini) แล้วเบราว์เซอร์ยิงไปหาผู้ให้บริการโดยตรง
เอกสารนี้สรุปว่าตอนนี้ key ถูกจัดการอย่างไร ยังเหลือความเสี่ยงอะไร และทำไมยังไม่ใช้ backend proxy

## สิ่งที่ทำแล้ว

| ความเสี่ยงเดิม | สิ่งที่แก้ | ไฟล์ |
|---|---|---|
| key เป็น plaintext ใน localStorage คีย์ `us-dash-keys` (ปนกับค่าโควตา) | เข้ารหัส AES-GCM 256 (Web Crypto) ด้วยกุญแจ non-extractable ที่เก็บใน IndexedDB แล้วเก็บ ciphertext แยกที่ `us-dash-api-keys-v2` ส่วน `us-dash-keys` เหลือแค่ค่าโควตา | `src/api/keyVault.js` |
| ผู้ใช้เดิมมี key plaintext ค้างอยู่ | ย้ายเข้า vault อัตโนมัติตอนเปิดแอป และ **ลบ plaintext ก็ต่อเมื่อถอดรหัสกลับมาตรวจแล้วตรงกัน** (ถ้า IndexedDB ขัดข้อง จะไม่ลบ) | `initApiKeyVault()` |
| ไฟล์ "สำรองข้อมูล" มี key แบบ plaintext | ไม่รวม key ในไฟล์สำรองอีกต่อไป; ไฟล์สำรองรุ่นเก่าที่มี key ยังนำเข้าได้ (key จะถูกย้ายเข้า vault) | `exportBackup` / `importBackup` ใน `App.jsx` |
| key ในข้อความ error → console / UI | คำขอที่มี key ทุกเส้นผ่าน `secureFetch` ซึ่งล้าง key ออกจาก error ก่อนโยนต่อ (ล้างทั้งรูปแบบ `apikey=`/`token=`/`key=`, คีย์ Google `AIza…`, header และค่า key จริงที่แอปรู้จัก) | `src/api/secureFetch.js`, `src/utils/redact.js` |
| key ใน URL | Gemini ส่ง key ทาง header `x-goog-api-key` แทน `?key=`; ตอนเปิดแอปจะลบพารามิเตอร์ `apikey`/`token`/`key`/`td`/`fh`/`gemini` ออกจาก URL หน้าเว็บ (แอปไม่เคยอ่าน key จาก URL อยู่แล้ว) | `quotaEngine.js`, `main.jsx` |
| **key ของ Twelve Data / Finnhub อยู่ใน URL คำขอ API** (เห็นใน browser history ของ `api.twelvedata.com`/`finnhub.io`, referrer header ถ้ามี, และ log ฝั่งเซิร์ฟเวอร์ของผู้ให้บริการ/ตัวกลางระหว่างทาง) | ยืนยันจากเอกสารทางการแล้วว่าทั้งสองเจ้ารองรับ key ผ่าน header (Twelve Data: `Authorization: apikey <key>`, Finnhub: `X-Finnhub-Token: <key>`) — เปลี่ยนทุกจุดที่ยิง API ให้ใช้ header เป็นค่าเริ่มต้น ไม่มี `apikey=`/`token=` ใน URL อีกต่อไป มี fallback อัตโนมัติกลับไปเป็น query string เฉพาะกรณี header ใช้ไม่ได้จริง (เช่น CORS ปฏิเสธ) เพื่อไม่ให้แอปพังถ้าสมมติฐานเรื่อง CORS ผิด — ดูรายละเอียดในหัวข้อถัดไป | `src/api/authRequest.js`, `src/api/priceSeries.js`, `src/api/recommendationScan.js` |
| ผู้ใช้ไม่รู้ว่าไม่ปลอดภัย 100% | แสดงคำเตือนถาวรใน ⚙️ การตั้งค่า + สถานะการเข้ารหัส + ปุ่ม "ลบ API Keys ออกจากเบราว์เซอร์นี้" | `SettingsPanel.jsx` |

ทดสอบด้วย `npm run test:keys`

## ข้อจำกัดที่ยังมี (ตั้งใจให้ชัด)

- **การเข้ารหัสฝั่ง frontend เป็นแค่อุปสรรค** แอปต้องถอดรหัสเองเพื่อเอา key ไปยิง API สคริปต์ที่ถูกแทรกเข้าหน้าเว็บ (XSS) จึงเรียกโค้ดเดียวกันถอดรหัสได้ สิ่งที่กันได้จริงคือการอ่านข้อมูลดิบจาก storage (ไฟล์โปรไฟล์ที่ถูกก๊อป, ส่วนขยายที่อ่านแค่ localStorage, เครื่องถูกยึด)
- **Twelve Data และ Finnhub ส่ง key ผ่าน HTTP header เป็นค่าเริ่มต้นแล้ว** (`Authorization: apikey <key>` และ `X-Finnhub-Token: <key>` ตามลำดับ) ยืนยันจากเอกสารทางการของทั้งสองเจ้าว่ารองรับวิธีนี้แทน query string (`?apikey=`, `?token=`) และตั้งใจให้เรียกจากฝั่ง client ได้ตรง ๆ — ข้อจำกัดที่ยังเหลืออยู่คือเอกสารไม่ได้ยืนยันชัดเจนว่า CORS preflight ของทั้งสองบริการตอบ `Access-Control-Allow-Headers` ครอบคลุม header เหล่านี้จากทุก origin 100% (แซนด์บ็อกซ์พัฒนาไม่มีเครือข่ายให้ทดสอบยิงจริงข้ามโดเมน) ถ้าสมมติฐานนี้ผิด เบราว์เซอร์จะปฏิเสธ preflight และรายงานเป็น `TypeError: Failed to fetch` เหมือนเน็ตล่ม เพื่อไม่ให้แอปพังทั้งฟีเจอร์ราคาหุ้นเงียบ ๆ จึงเพิ่ม fallback อัตโนมัติ: ลองยิงด้วย header ก่อนเสมอ ถ้าล้มเหลวระดับเครือข่ายจะถอยไปใช้ query string ทันทีในคำขอเดียวกัน แล้วจำผลไว้ในหน่วยความจำของแท็บ (ไม่ persist) เพื่อไม่ต้องลองซ้ำทุกครั้ง — ดู `src/api/authRequest.js` และเทสต์ใน `tests/key-vault.test.mjs`
  - ผลคือ: กรณีปกติ (header ใช้ได้) → ไม่มี key ใน URL คำขอเลย จึงไม่ติดไปกับ browser history/referrer/log ของฝั่งรับ ตามเกณฑ์ของงานนี้; กรณี CORS ปฏิเสธ header จริง ๆ → ยังคงถอยไปใช้ query string เหมือนเดิม (มีอธิบายไว้ในโค้ดว่าทำไมถึงยอมรับความเสี่ยงนี้แทนที่จะให้แอปใช้งานไม่ได้) และค่า key ก็ยังไม่รั่วไปที่ console/UI/URL หน้าเว็บอยู่ดี เพราะผ่าน `secureFetch`/`redact.js` เหมือนเดิม
- ถ้าเบราว์เซอร์ไม่รองรับ (ไม่ใช่ HTTPS/localhost หรือไม่มี IndexedDB) แอปจะ **ไม่บันทึก key ลงเครื่อง** (อยู่ในหน่วยความจำแท็บเดียว) แทนที่จะถอยไปเก็บ plaintext และ UI จะบอกผู้ใช้

## พิจารณา backend proxy — ข้อสรุป: ยังไม่เพิ่ม

เหตุผล
1. **โมเดลปัจจุบันคือ "ผู้ใช้ใส่ key ของตัวเอง"** proxy ซ่อน key ได้จริงก็ต่อเมื่อ key อยู่บนเซิร์ฟเวอร์ (เจ้าของแอปใช้ key ของตัวเองให้ทุกคน) ถ้ายังให้ผู้ใช้พิมพ์ key เอง key ก็ยังต้องผ่านเบราว์เซอร์ไปหา proxy — ช่วยได้แค่เรื่อง URL/log ไม่ได้กัน XSS
2. **ถ้าเก็บ key ไว้บนเซิร์ฟเวอร์ แอปจะกลายเป็นบริการสาธารณะ** ต้องมี CORS จำกัดโดเมน, allowlist เส้นทาง API, rate limit ต่อ IP/ผู้ใช้ และ auth ไม่งั้นใครก็ใช้โควตาของเจ้าของจนหมดได้ (แผนฟรีของ Twelve Data มีแค่ 800 credit/วัน)
3. ต้องมีโครงสร้างพื้นฐานเพิ่ม (Cloudflare Worker / Vercel function) แทนที่จะเป็น GitHub Pages ล้วน

ถ้าจะทำ (เมื่อเปลี่ยนไปเป็นโมเดลที่เจ้าของแอปถือ key)
- Cloudflare Worker เก็บ key เป็น secret, รับ `/td/*`, `/fh/*`, `/gemini` แล้วเติม key ฝั่งเซิร์ฟเวอร์ก่อนส่งต่อ, ตรวจ `Origin`, จำกัดอัตราต่อ IP
- ฝั่งแอป: ทำ base URL ให้ตั้งค่าได้ผ่าน `VITE_TD_BASE` / `VITE_FH_BASE` / `VITE_GEMINI_BASE` และตัดเงื่อนไข "ต้องมี key ก่อนถึงจะยิง" ออก (กระจายอยู่หลายจุดใน `App.jsx`, `priceSeries.js`, `PortfolioView.jsx`) — คำขอทุกเส้นผ่าน `secureFetch` อยู่แล้ว จึงมีจุดเสียบจุดเดียว

## ข้อเสนอต่อยอด (ยังไม่ได้ทำ)

- **Content-Security-Policy** (production เท่านั้น เพราะ dev server ของ Vite ฉีด inline script) จำกัด `script-src 'self'` และ `connect-src` เฉพาะ `api.twelvedata.com`, `finnhub.io`, `generativelanguage.googleapis.com`, `open.er-api.com` — ลดทั้งโอกาส XSS และช่องทางส่ง key ออกไปนอก ต้องไล่ให้ครบว่า `img-src` ต้องมีโดเมนโลโก้ใดบ้างก่อนเปิดใช้
- ผู้ใช้ควรจำกัด Gemini key ตาม HTTP referrer ของโดเมนที่ deploy (ทำในหน้าจัดการ key ของ Google) — โค้ดนี้ไม่ได้ปิด referrer จึงใช้ได้
