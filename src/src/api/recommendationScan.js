import { fhQueue } from "./quotaEngine.js";
import { pick } from "./priceSeries.js";
import { TRENDING_UNIVERSE } from "../data/trendingUniverse.js";

// 2. Pool = TRENDING_UNIVERSE ที่คัดสรรไว้ล่วงหน้า รวมกับหุ้นทั่วโลกจาก Twelve Data (ดูหัวข้อ
//    STOCK UNIVERSE ด้านบน) รวมกันสูงสุด ~1,200 ตัว กระจายทุกอุตสาหกรรม/ทุกประเทศ — สแกนจนพบ
//    ผู้เข้าเกณฑ์ครบ SCAN_BUFFER ตัวแล้วให้ "หยุดสแกนทันที" (Fast Stop) เพื่อประหยัดโควตา
export const WEEKLY_PICK_COUNT = 10;
export const SCAN_BUFFER = 30;
// จำนวนสัญลักษณ์ที่ยิง Finnhub (/stock/metric เพียงตัวเดียว) พร้อมกันต่อรอบ — เกณฑ์ใหม่ทั้งหมด
// (ข้อ 1-3 ด้านล่าง) คำนวณจากตัวเลขงบการเงิน/มูลค่าใน metric object ล้วน ๆ ไม่ต้องยิง company-news,
// social-sentiment หรือ profile2 อีกต่อไป (เดิม 4 คำขอ/หุ้น ตอนนี้เหลือ 1 คำขอ/หุ้น) จึงสแกนได้
// เร็วขึ้นและประหยัดโควตากว่าเดิมมาก คำนวณจากเพดานคำขอต่อนาทีของ Plan ที่ผู้ใช้ตั้งไว้จริง
export const fundScanBatchSize = () => Math.max(1, Math.floor(fhQueue.effectiveLimit()));
// เก็บ "ผลสแกน" (ลิสต์หุ้นที่เข้าเกณฑ์) ของแต่ละสัปดาห์ไว้ใน localStorage โดยคีย์ด้วย weekKey
// เพื่อให้สแกนพูลทั้งหมดแค่ "ครั้งเดียวต่อสัปดาห์" — เปิดเว็บใหม่หรือสลับแท็บกี่ครั้งก็ตาม
// จะไม่ไล่สแกนพูลซ้ำอีก จนกว่าจะขึ้นสัปดาห์ใหม่ (weekKey เปลี่ยน) ถึงจะสแกนชุดใหม่โดยอัตโนมัติ
// อัปเดตเวอร์ชันคีย์เป็น v10 เพื่อล้างผลสแกนสัปดาห์เก่าที่คัดด้วยเกณฑ์ "ความสนใจนักลงทุน (ข่าว/
// โซเชียล) + ปัจจัยพื้นฐานเป็นบวก/sector ร้อนแรง" ทิ้งไปโดยอัตโนมัติ — บังคับให้สแกนใหม่ทั้งพูล
// ด้วยเกณฑ์ "Hypergrowth VI" ชุดใหม่ (Disruptive Growth + Margin of Safety + เป้าหมายผลตอบแทน) ทันที
export const WEEKLY_PICKS_STORE_KEY = "us-dash-weekly-picks-v10";
// จุดพักการสแกน (checkpoint) — เก็บ "ไล่สแกนไปถึงตำแหน่งไหนแล้ว" ของสัปดาห์ปัจจุบัน
// เหตุผล: พูลหุ้นมีหลักพันตัว แต่แผนฟรีของ Finnhub มีเพดานคำขอต่อนาทีจำกัด จึงอาจสแกนไม่จบใน
// รอบเดียว เดิมพอโควตาหมดกลางคัน ผลที่สแกนได้บางส่วนจะถูก "ล็อกไว้ทั้งสัปดาห์" ตอนนี้ถ้าหยุดเพราะ
// โควตา จะบันทึกเป็น checkpoint แทน แล้วรอบถัดไปสแกนต่อจากตำแหน่งเดิม จนกว่าจะครบ SCAN_BUFFER
// หรือหมดพูล ถึงจะล็อกผลจริง — อัปเดตเวอร์ชันเป็น v3 คู่กับ WEEKLY_PICKS_STORE_KEY (โครงสร้างข้อมูล
// เปลี่ยน เอา news/social ออก เหลือแค่ fund + eligibility ต่อสัญลักษณ์)
export const SCAN_CHECKPOINT_KEY = "us-dash-scan-checkpoint-v3";

/* ------------------------------------------------------------
   เกณฑ์การคัดกรองหุ้นแนะนำประจำสัปดาห์ (v3 — "Hypergrowth VI") — โละเกณฑ์เดิมทั้งหมดทิ้ง
   (เดิม: Volume Surge + MA20/MA50 momentum, แล้วต่อมาเป็น ข่าว/โซเชียล + sector ร้อนแรง/catalyst)
   แทนที่ด้วยเกณฑ์บังคับใหม่ 3 ข้อ (ต้องผ่านครบทั้ง 3 ข้อ) ที่มาจากตัวเลขงบการเงิน/มูลค่าล้วน ๆ
   จาก Finnhub /stock/metric เท่านั้น ไม่มี Story/Narrative/ข่าว/โซเชียล/sector-keyword/catalyst
   ปะปนอยู่ในเกณฑ์บังคับอีกต่อไป (ดูปรัชญาการลงทุนที่ผู้ใช้กำหนด: หาหุ้นต้นน้ำแบบ Disruptive
   Growth ราคาถูกเชิงมูลค่า มี Margin of Safety สูงสุด และมี Risk-Reward ไม่สมมาตรแบบ "1 บาทลุ้น
   100 บาท" ไม่ใช่ "1 บาทลุ้น 2 บาท" โดยไม่สนความผันผวนของราคาตลาดเลย):

     1) Disruptive Growth (บังคับ) — เติบโตทะลุกรอบ ไม่ใช่แค่ Secular Growth ธรรมดา ๆ (~10-15%/ปี)
        วัดจากอัตราเติบโตของรายได้ (revenueGrowthTTMYoy) หรือกำไรต่อหุ้น (epsGrowthTTMYoy) จาก
        Finnhub /stock/metric — เอาค่าที่ "สูงที่สุด" ที่มีข้อมูลจริง (getGrowthRate) ต้อง ≥
        MIN_DISRUPTIVE_GROWTH_PCT ถึงจะผ่าน (ดู getGrowthEligibility)

     2) Margin of Safety (บังคับ) — ราคาต้องถูกเมื่อเทียบกับอัตราเติบโตจริง ๆ ไม่ใช่ถูกเฉย ๆ โดย
        ไม่ดูการเติบโต ใช้อัตราส่วน "จ่ายเท่าไหร่ต่อการเติบโต 1%" (ดู getValuationSignals):
        - PEG = P/E (peTTM) ÷ EPS Growth% — ใช้เมื่อบริษัททำกำไรแล้วและ EPS โตเป็นบวก (Peter Lynch)
        - PSG = P/S (psTTM) ÷ Revenue Growth% — ใช้แทนเมื่อยังไม่มีกำไร (ปกติของหุ้น Hypergrowth
          ต้นน้ำส่วนใหญ่ที่ยัง All-in ลงทุนขยายธุรกิจ ไม่เน้นกำไรระยะสั้น)
        อัตราส่วนนี้ต้อง ≤ MAX_VALUATION_RATIO (ต่ำกว่า FAIR_VALUE_RATIO = 1.0 ตามเกณฑ์ "ยุติธรรม"
        แบบ Lynch อยู่แล้ว) ถึงจะถือว่ามี Margin of Safety จริง ไม่ใช่แค่ "ดูถูก" เพราะยังไม่โต

     3) เป้าหมายผลตอบแทน/Risk-Reward ไม่สมมาตร (บังคับ) — คำนวณ "ผลตอบแทนทบต้นโดยประมาณต่อปี"
        (Implied CAGR, ดู computeImpliedCAGR) จากสมมติฐาน 2 ส่วนรวมกันตลอด REVALUATION_YEARS ปี:
        (ก) พื้นฐานธุรกิจโตต่อเนื่องในอัตราจากข้อ 1 (fundamentalMultiple)
        (ข) ตลาดปรับมูลค่าหุ้น (re-rate) กลับสู่ระดับ "ยุติธรรม" (FAIR_VALUE_RATIO) จากส่วนลด
            ในข้อ 2 (reratingMultiple)
        ตัวเลขนี้คือ "เป้าหมายเชิงตัวเลขชัดเจน" ของหุ้นแต่ละตัว (ไม่ใช่ความหวัง/การเดา) ต้อง ≥
        MIN_TARGET_CAGR_PCT (+50%/ปี ตามที่กำหนด) ถึงจะผ่าน — และใช้ตัวเลขนี้แหละเป็นตัวจัดอันดับ
        สุดท้าย (คะแนนสูงสุดก่อน) แทนคะแนนรวมแบบถ่วงน้ำหนักเดิม เพราะเป็นตัวแทนของ Risk-Reward
        โดยตรงอยู่แล้ว — ยิ่งสูง ยิ่งเข้าข่าย "เอา 1 บาทไปลุ้น 100 บาท"

   ไม่มีการใช้ความผันผวนของราคา (Volume/MA/Beta) หรือข่าว/โซเชียล/sector-keyword/catalyst เป็น
   เกณฑ์บังคับหรือคะแนนอีกต่อไปตามที่กำหนด (โมเมนตัมราคาระยะสั้นไม่เกี่ยวกับ Thesis พื้นฐานระยะยาว)
   ------------------------------------------------------------ */
export const MIN_DISRUPTIVE_GROWTH_PCT = 30; // อัตราเติบโตรายได้/กำไรขั้นต่ำ (%YoY) ถึงจะนับเป็น "Disruptive" ไม่ใช่ Secular ธรรมดา
export const FAIR_VALUE_RATIO = 1.0;         // อัตราส่วน PEG/PSG ที่ถือว่า "ยุติธรรม" (Peter Lynch: PEG=1 คือราคาพอดีกับการเติบโต)
export const MAX_VALUATION_RATIO = 0.75;     // ต้องถูกกว่ายุติธรรมอย่างน้อย 25% (Margin of Safety ขั้นต่ำ) ถึงจะผ่านเกณฑ์ข้อ 2
export const MIN_TARGET_CAGR_PCT = 50;       // ผลตอบแทนทบต้นโดยประมาณขั้นต่ำที่ต้องคำนวณได้ต่อปี ตามเป้าหมาย +50-100%/ปี
export const REVALUATION_YEARS = 3;          // กรอบเวลาที่ Thesis ควรพิสูจน์ตัวเอง (ธุรกิจโต + ตลาด re-rate กลับสู่มูลค่ายุติธรรม)
export const GROWTH_RATE_CAP_PCT = 200;      // เพดานกันอัตราเติบโตที่ผิดปกติ (data error) ไม่ให้ดันผลตอบแทนทบต้นระเบิดเกินจริง
export const RERATING_CAP_MULTIPLE = 5;      // เพดานกันตัวคูณ re-rating ระเบิดเมื่อ valuation ratio ใกล้ 0 (ข้อมูลผิดปกติ/หุ้นแทบไม่มีมูลค่า)

// ดึงตัวเลขแนวโน้มพื้นฐาน (การเติบโตของรายได้/กำไร + P/E + P/S) จาก object metric ของ Finnhub —
// ใช้ pick() ลองหลายชื่อฟิลด์เผื่อ Finnhub เปลี่ยนชื่อฟิลด์หรือบางสัญลักษณ์ไม่มีบางฟิลด์
export function getGrowthSignals(fundamentals) {
  if (!fundamentals) return { revenueGrowth: null, epsGrowth: null, peTTM: null, psTTM: null };
  const revenueGrowth = pick(fundamentals, [
    "revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy", "revenueGrowth5Y", "revenueGrowth3Y",
  ]);
  const epsGrowth = pick(fundamentals, [
    "epsGrowthTTMYoy", "epsGrowthQuarterlyYoy", "epsGrowth5Y", "epsGrowth3Y",
  ]);
  const peTTM = pick(fundamentals, [
    "peTTM", "peBasicExclExtraTTM", "peExclExtraTTM", "peInclExtraTTM", "peNormalizedAnnual",
  ]);
  const psTTM = pick(fundamentals, ["psTTM", "psAnnual"]);
  return { revenueGrowth, epsGrowth, peTTM, psTTM };
}

// เกณฑ์บังคับข้อ 1 — เอาอัตราเติบโตที่ "สูงที่สุด" จากรายได้หรือกำไร (อย่างใดอย่างหนึ่งที่มีข้อมูล
// จริง) มาเป็นตัวแทนความเป็น Disruptive Growth ของบริษัท — ถ้าไม่มีข้อมูลทั้งคู่เลยถือว่าข้อมูล
// ไม่พอ (คืนค่า null แล้วจะไม่ผ่านเกณฑ์โดยอัตโนมัติ ไม่เดาสุ่มว่าโตหรือไม่โต)
export function getGrowthRate(growth) {
  const candidates = [growth?.revenueGrowth, growth?.epsGrowth].filter((v) => v != null && !Number.isNaN(v));
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
export function getGrowthEligibility(growth) {
  const growthRate = getGrowthRate(growth);
  return { growthRate, eligible: growthRate != null && growthRate >= MIN_DISRUPTIVE_GROWTH_PCT };
}

// เกณฑ์บังคับข้อ 2 — คำนวณ PEG (มีกำไรแล้ว) หรือ PSG (ยังไม่มีกำไร ใช้ P/S แทน) ตามที่มีข้อมูลจริง
// ยิ่งอัตราส่วนต่ำ ยิ่งจ่ายน้อยต่อการเติบโต 1% = ยิ่งมี Margin of Safety สูง (marginOfSafetyPct
// เทียบกับ FAIR_VALUE_RATIO ให้เห็นเป็น % ตรง ๆ บนการ์ด)
export function getValuationSignals(growth) {
  const { revenueGrowth, epsGrowth, peTTM, psTTM } = growth || {};
  let ratio = null;
  let method = null;
  if (epsGrowth != null && epsGrowth > 0 && peTTM != null && peTTM > 0) {
    ratio = peTTM / epsGrowth;
    method = "PEG";
  } else if (revenueGrowth != null && revenueGrowth > 0 && psTTM != null && psTTM > 0) {
    ratio = psTTM / revenueGrowth;
    method = "PSG";
  }
  const marginOfSafetyPct = ratio != null ? (FAIR_VALUE_RATIO / ratio - 1) * 100 : null;
  return { ratio, method, marginOfSafetyPct };
}
export function getValuationEligibility(valuation) {
  return { ...valuation, eligible: valuation.ratio != null && valuation.ratio <= MAX_VALUATION_RATIO };
}

// เกณฑ์บังคับข้อ 3 — ผลตอบแทนทบต้นโดยประมาณต่อปี (Implied CAGR) จากพื้นฐานธุรกิจที่โตต่อเนื่อง
// (ข้อ 1) รวมกับตลาด re-rate มูลค่ากลับสู่ระดับยุติธรรม (ส่วนลดจากข้อ 2) ตลอด REVALUATION_YEARS ปี
// — เป็นตัวเลขประมาณการเพื่อ "จัดลำดับ/คัดกรอง" เท่านั้น ไม่ใช่การพยากรณ์ราคาหุ้นที่แม่นยำ
export function computeImpliedCAGR({ growthRate, valuationRatio }) {
  if (growthRate == null || valuationRatio == null || valuationRatio <= 0) return null;
  const g = Math.min(growthRate, GROWTH_RATE_CAP_PCT) / 100;
  const fundamentalMultiple = Math.pow(1 + g, REVALUATION_YEARS);
  const reratingMultiple = Math.min(FAIR_VALUE_RATIO / valuationRatio, RERATING_CAP_MULTIPLE);
  const totalMultiple = fundamentalMultiple * reratingMultiple;
  if (!(totalMultiple > 0)) return null;
  return (Math.pow(totalMultiple, 1 / REVALUATION_YEARS) - 1) * 100;
}

// รวมเกณฑ์บังคับทั้ง 3 ข้อเข้าด้วยกันต่อสัญลักษณ์หนึ่งตัว — ต้องผ่านครบทั้ง 3 ข้อ (AND) เท่านั้น
// ถึงจะเข้ารอบ (ไม่มีทางลัด/ทางเลือกแบบ "ผ่านข้อใดข้อหนึ่งก็พอ" เหมือนเกณฑ์ชุดเก่าอีกต่อไป —
// ตั้งใจให้เข้มงวดตามที่กำหนด "Best of the Best เท่านั้น")
export function getHypergrowthEligibility(fundamentals) {
  const growth = getGrowthSignals(fundamentals);
  const growthElig = getGrowthEligibility(growth);
  const valuation = getValuationEligibility(getValuationSignals(growth));
  const impliedCAGR = computeImpliedCAGR({ growthRate: growthElig.growthRate, valuationRatio: valuation.ratio });
  const rewardEligible = impliedCAGR != null && impliedCAGR >= MIN_TARGET_CAGR_PCT;
  return {
    growth, growthRate: growthElig.growthRate, valuation, impliedCAGR,
    growthEligible: growthElig.eligible,
    valuationEligible: valuation.eligible,
    rewardEligible,
    eligible: growthElig.eligible && valuation.eligible && rewardEligible,
  };
}

export function getCapTier(mktCapB) {
  if (!mktCapB || mktCapB <= 0) return null;
  if (mktCapB >= 10) return "Large";
  if (mktCapB >= 2) return "Mid";
  return "Small";
}
export const CAP_TIER_TH = { Large: "Large Cap", Mid: "Mid Cap", Small: "Small Cap" };
export const CAP_TIER_STYLE = {
  Large: "text-blue-300 bg-blue-500/10 border-blue-500/30",
  Mid: "text-purple-300 bg-purple-500/10 border-purple-500/30",
  Small: "text-pink-300 bg-pink-500/10 border-pink-500/30",
};

// ลำดับการสแกนของสัปดาห์นี้ — เดิมหมุน (rotate) พูลทั้งก้อนด้วย weekKey % poolLen ทำให้จุด
// เริ่มสแกนของเกือบทุกสัปดาห์ตกไปอยู่ "กลางพูลหุ้นทั่วโลก" ซึ่งส่วนใหญ่เป็นหุ้นสภาพคล่องต่ำที่
// แทบไม่มีทางผ่านเกณฑ์เลย ส่วนหุ้นคัดสรร (TRENDING_UNIVERSE) ที่โอกาสผ่านสูงสุด กลับถูกไล่สแกน
// เป็นกลุ่มท้ายสุด = เผาโควตาไปหลายร้อย credit ก่อนจะเจอตัวแรก
// แก้เป็นสแกน 2 ชั้น: หุ้นคัดสรรก่อนเสมอ (หมุนลำดับกันเองภายในกลุ่ม เพื่อไม่ให้ได้ชุดซ้ำเดิม
// ทุกสัปดาห์) แล้วค่อยต่อด้วยพูลทั่วโลก — เงื่อนไข Fast Stop (พบครบ SCAN_BUFFER) จึงทำงาน
// ตั้งแต่ก้อนแรก ๆ แทนที่จะต้องไล่จนสุดพูล
export function getWeeklyRotationOrder(weekKeyStr, poolArr) {
  const dateObj = weekKeyStr ? new Date(weekKeyStr) : new Date();
  const weekKey = Math.floor(dateObj.getTime() / (1000 * 60 * 60 * 24 * 7));
  const pool = poolArr && poolArr.length ? poolArr : TRENDING_UNIVERSE;
  if (pool.length === 0) return [];
  const curatedSet = new Set(TRENDING_UNIVERSE.map((it) => it.symbol));
  const curated = [];
  const rest = [];
  for (const it of pool) (curatedSet.has(it.symbol) ? curated : rest).push(it);
  const rotate = (arr) => {
    if (arr.length === 0) return [];
    const start = weekKey % arr.length;
    return Array.from({ length: arr.length }, (_, i) => arr[(start + i) % arr.length]);
  };
  return [...rotate(curated), ...rotate(rest)];
}

/* ============================================================
   RECOMMENDED STOCK CARD + CAROUSEL
   ============================================================ */
