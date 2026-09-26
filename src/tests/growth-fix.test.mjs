import assert from "node:assert/strict";

const SRC = new URL("../src/", import.meta.url);
const imp = (p) => import(new URL(p, SRC).href);

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}

const {
  getGrowthSignals, getGrowthRate, getGrowthEligibility,
  getValuationSignals, getValuationEligibility,
  getHypergrowthEligibility, computeImpliedCAGR,
  MIN_DISRUPTIVE_GROWTH_PCT,
} = await imp("api/recommendationScan.js");

/* ---------------------------------------------------------------
   เคส 1: BILI จริง — Finnhub รายงาน epsGrowthTTMYoy สูงผิดปกติ (ฐาน EPS ปีก่อนเกือบศูนย์
   จากที่เพิ่งพลิกมีกำไร) แต่รายได้จริงโตแค่ ~8% YoY (ยืนยันจากงบ Q2 2026 ของบริษัท)
   ต้อง: growthRate ต้องมาจากรายได้ (8), ไม่ใช่ EPS (567), และไม่ eligible เพราะ 8 < 30
--------------------------------------------------------------- */
await test("BILI-like: growthRate ใช้รายได้ (8%) ไม่ใช่ EPS ที่บิดเบือน (567%)", () => {
  const fundamentals = {
    revenueGrowthTTMYoy: 8.1,
    epsGrowthTTMYoy: 567.64, // ค่าจริงที่ Finnhub เคยรายงาน (ฐาน EPS ปีก่อนเกือบ 0)
    peTTM: 45,
    psTTM: 3.2,
  };
  const growth = getGrowthSignals(fundamentals);
  const rate = getGrowthRate(growth);
  assert.equal(rate.value, 8.1, `ควรได้ 8.1 (รายได้) แต่ได้ ${rate.value}`);
  assert.equal(rate.isEpsFallback, false);
  const elig = getGrowthEligibility(growth);
  assert.equal(elig.eligible, false, "8.1% < เกณฑ์ 30% ต้องไม่ผ่าน");
});

await test("HON-like: growthRate ใช้รายได้ (3.4%) ไม่ใช่ EPS ที่บิดเบือน (169.74%)", () => {
  const fundamentals = {
    revenueGrowthTTMYoy: 3.4,
    epsGrowthTTMYoy: 169.74, // ค่าจริงที่ Finnhub เคยรายงาน (ฐาน EPS ปีก่อนเพี้ยนจากการขายธุรกิจ)
    peTTM: 25,
    psTTM: 2.1,
  };
  const growth = getGrowthSignals(fundamentals);
  const rate = getGrowthRate(growth);
  assert.equal(rate.value, 3.4);
  assert.equal(rate.isEpsFallback, false);
  const elig = getGrowthEligibility(growth);
  assert.equal(elig.eligible, false);
});

/* ---------------------------------------------------------------
   เคส 2: Valuation (PEG/PSG) ต้องใช้ PSG (รายได้) เป็นหลักเหมือนกัน แม้ epsGrowth จะสูงกว่า
   และ peTTM จะมีข้อมูลก็ตาม — เดิมโค้ดเก่าจะเลือก PEG ก่อนเสมอถ้ามีกำไรแล้ว ทำให้ margin of
   safety พุ่งผิดปกติ (ดูเคส BILI/HON ในภาพจริงที่ผู้ใช้ส่งมา: PEG 0.05x, MoS +2000%)
--------------------------------------------------------------- */
await test("Valuation ใช้ PSG (รายได้) ก่อนเสมอ ไม่ใช่ PEG (EPS) แม้มีข้อมูล EPS/PE", () => {
  const fundamentals = {
    revenueGrowthTTMYoy: 8.1,
    epsGrowthTTMYoy: 567.64,
    peTTM: 45,     // ถ้าใช้ PEG (บั๊กเดิม): 45/567.64 = 0.079x -> MoS +1965% (เหมือนภาพที่ผู้ใช้ส่งมา)
    psTTM: 3.2,
  };
  const growth = getGrowthSignals(fundamentals);
  const valuation = getValuationSignals(growth);
  assert.equal(valuation.method, "PSG", `ควรเป็น PSG แต่ได้ ${valuation.method}`);
  const expectedRatio = 3.2 / 8.1;
  assert.ok(Math.abs(valuation.ratio - expectedRatio) < 1e-9);
  assert.equal(valuation.isEpsFallback, false);
  // จุดสำคัญจริง ๆ ที่ต้องยืนยัน: ไม่ว่า valuation ratio เดี่ยว ๆ จะออกมาเท่าไหร่ หุ้นแบบนี้ก็ต้อง
  // ไม่ผ่านเกณฑ์ "Hypergrowth VI" โดยรวมอยู่ดี เพราะติดเกณฑ์ข้อ 1 (growth >= 30%) ไปก่อนแล้ว
  // (AND logic ใน getHypergrowthEligibility) — ไม่ใช่ปล่อยให้ PEG ที่บิดเบือนไปช่วยดันให้ผ่านได้
  const elig = getHypergrowthEligibility(fundamentals);
  assert.equal(elig.eligible, false, "ต้องไม่ผ่านเกณฑ์รวม แม้ valuation ratio จะดูถูกก็ตาม");
  assert.equal(elig.valuation.method, "PSG", "แม้แต่ตอนเช็คเกณฑ์รวมก็ต้องไม่หลุดไปใช้ PEG");
});

/* ---------------------------------------------------------------
   เคส 3: หุ้นที่ไม่มีข้อมูลรายได้เลยจริง ๆ (Finnhub ไม่มีฟิลด์ revenueGrowth ใด ๆ) — ต้อง fallback
   ไป EPS ได้ (ไม่ใช่ปฏิเสธไปเลย) แต่ต้องติด flag isEpsFallback = true ให้ UI โชว์คำเตือน
--------------------------------------------------------------- */
await test("ไม่มีข้อมูลรายได้เลย -> fallback เป็น EPS พร้อม flag เตือน", () => {
  const fundamentals = { epsGrowthTTMYoy: 42, peTTM: 30 };
  const growth = getGrowthSignals(fundamentals);
  assert.equal(growth.revenueGrowth, null);
  const rate = getGrowthRate(growth);
  assert.equal(rate.value, 42);
  assert.equal(rate.isEpsFallback, true, "ต้องติด flag ว่าใช้ EPS แทน");
  const valuation = getValuationSignals(growth);
  assert.equal(valuation.method, "PEG");
  assert.equal(valuation.isEpsFallback, true);
});

/* ---------------------------------------------------------------
   เคส 4: หุ้น hypergrowth ของจริงที่สมเหตุสมผล (เช่น รายได้โต 45% YoY, PS ถูกกว่ามูลค่ายุติธรรม)
   ต้องยังคงผ่านเกณฑ์และคำนวณ Implied CAGR ได้ตามปกติ — ยืนยันว่าการแก้ไม่ได้ทำให้หุ้นโตจริงหลุด
   เกณฑ์ไปด้วย (ไม่ใช่ over-correct จนกรองทุกอย่างทิ้ง)
--------------------------------------------------------------- */
await test("หุ้น hypergrowth จริง (รายได้โต 45%, ถูกกว่ามูลค่ายุติธรรม) ยังผ่านเกณฑ์ปกติ", () => {
  const fundamentals = {
    revenueGrowthTTMYoy: 45,
    epsGrowthTTMYoy: 60,
    peTTM: 80,
    psTTM: 12, // PSG = 12/45 = 0.267 < 0.75 (MAX_VALUATION_RATIO) -> ผ่าน
  };
  const elig = getHypergrowthEligibility(fundamentals);
  assert.equal(elig.growthRate, 45);
  assert.equal(elig.growthIsEpsFallback, false);
  assert.equal(elig.growthEligible, true, "45% >= 30% ต้องผ่าน");
  assert.equal(elig.valuation.method, "PSG");
  assert.equal(elig.valuationEligible, true, `PSG ratio ${elig.valuation.ratio} ควร <= 0.75`);
  assert.ok(elig.impliedCAGR > 0, "ควรคำนวณ Implied CAGR ได้เป็นบวก");
});

/* ---------------------------------------------------------------
   เคส 5: ไม่มีข้อมูลอะไรเลย -> ต้อง null/ไม่ผ่าน ไม่ใช่เดาว่าผ่าน (regression ของเกณฑ์เดิม)
--------------------------------------------------------------- */
await test("ไม่มีข้อมูล fundamentals เลย -> ไม่ผ่านเกณฑ์ ไม่ throw", () => {
  const elig = getHypergrowthEligibility(null);
  assert.equal(elig.growthRate, null);
  assert.equal(elig.eligible, false);
});

await test("MIN_DISRUPTIVE_GROWTH_PCT ยังคงเป็น 30 ตามที่ผู้ใช้ตั้งไว้เดิม (ไม่ได้แอบเปลี่ยนเกณฑ์)", () => {
  assert.equal(MIN_DISRUPTIVE_GROWTH_PCT, 30);
});

/* ---------------- print report ---------------- */
console.log("\n=== growth-fix.test.mjs ===");
for (const [status, name, err] of results) {
  console.log(`${status === "PASS" ? "✅" : "❌"} ${name}${err ? `\n   ${err}` : ""}`);
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
