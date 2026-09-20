// ------------------------------------------------------------------
// Loader สำหรับรันเทสต์ผ่าน plain `node` เท่านั้น (ไม่กระทบแอปจริง/Vite build เลย)
// ------------------------------------------------------------------
// ปัญหา: บาง module ในชั้น data (src/api/priceCache.js, src/api/transactionLedger.js) import
// ค่าคงที่ 2-3 ตัว (HIST_CACHE_PREFIX, TX_LEDGER_KEY) จากไฟล์ .jsx ในชั้น component (เพื่อให้ key
// ของ localStorage นิยามอยู่จุดเดียวกับ component ที่ใช้จริง) — เวลาแอปรันจริงผ่าน Vite ไม่มีปัญหา
// เพราะ Vite แปลง JSX ให้ก่อนเสมอ แต่ตัวรัน `node tests/*.test.mjs` แบบตรง ๆ (ไม่มี Vite) จะพัง
// เพราะ Node ESM loader ไม่รู้จักนามสกุล .jsx และไฟล์เหล่านั้นมี JSX syntax จริง (parse ไม่ผ่านอยู่ดี
// ต่อให้บอก format เฉย ๆ )
// ทางแก้ที่ไม่แตะสถาปัตยกรรมเดิม (ไม่ย้ายค่าคงที่ข้ามชั้น แค่เพื่อให้เทสต์รันได้): ให้ loader นี้
// "ปลอม" เฉพาะไฟล์ .jsx ที่ src/api/*.js เคย import ค่าคงที่มาใช้ ให้คืนค่าคงที่ตรงกันแทนของจริง
// (ไม่ต้อง parse JSX เลย) ส่วนไฟล์ .js/.mjs ทั้งหมดยังโหลดตามปกติ ไม่ถูกแตะต้อง
// ใช้ตอนรันเทสต์เท่านั้น: `node --experimental-loader ./tests/jsx-stub-loader.mjs tests/xxx.test.mjs`
// (ใช้ hook API แบบเก่าของ Node ตรง ๆ เพราะรันเป็นสคริปต์เดี่ยว ไม่ได้ฝังอยู่ใน entry point อื่น)
// ------------------------------------------------------------------

const STUB_SOURCE = `
  export const HIST_CACHE_PREFIX = "us-dash-hist-daily-v1-";
  export const TX_LEDGER_KEY = "us-dash-tx-ledger-v1";
  export const CHART_VISIBLE_BARS = 90;
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".jsx")) {
    return { url: `jsx-stub:${specifier}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("jsx-stub:")) {
    return { format: "module", source: STUB_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
