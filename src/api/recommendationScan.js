import { PRIORITY, fhQueue, tdBatchSize } from "./quotaEngine.js";
import { fhSingleFlight, pick, readFhCache, writeFhCache } from "./priceSeries.js";
import { TRENDING_UNIVERSE } from "../data/trendingUniverse.js";
import { FH_BASE } from "../data/appConfig.js";

// 2. Pool = TRENDING_UNIVERSE ที่คัดสรรไว้ล่วงหน้า รวมกับหุ้นทั่วโลกจาก Twelve Data (ดูหัวข้อ
//    STOCK UNIVERSE ด้านบน) รวมกันสูงสุด ~3,000 ตัว กระจายทุกอุตสาหกรรม/ทุกประเทศ
// 3. เกณฑ์ทางเทคนิค (Volume Surge + โมเมนตัมราคาเหนือ MA20/MA50 ต่อเนื่อง) เป็นเกณฑ์บังคับหลัก
//    ที่ต้องผ่านครบทั้งคู่ก่อนถึงจะเข้ารอบ จากนั้นให้คะแนนเสริมจากกระแสข่าว/ปัจจัยพื้นฐาน แล้วคัด
//    WEEKLY_PICK_COUNT ตัวสุดท้ายด้วยคะแนนรวมสูงสุด (ดู computeTrendScore) — สแกนจนพบผู้เข้าเกณฑ์
//    ทางเทคนิคครบ SCAN_BUFFER ตัวแล้วให้ "หยุดสแกนทันที" (Fast Stop) เพื่อประหยัดโควตา Twelve
//    Data ไม่ต้องไล่สแกนพูลทั้งหมดเสมอไป
export const WEEKLY_PICK_COUNT = 10;
export const SCAN_BUFFER = 30;
// จำนวนสัญลักษณ์ต่อก้อนระหว่างสแกนเกณฑ์ทางเทคนิค — เดิมตั้งตายตัวไว้ที่ 30 ซึ่ง "เกินเพดาน
// credit ต่อนาที" ของแผนฟรี (8 credit/นาที) เพราะคำขอ batch ของ Twelve Data เสีย credit เท่า
// จำนวนสัญลักษณ์ ก้อนละ 30 จึงโดนปฏิเสธ (429 run out of API credits) แทบทุกก้อน
// ตอนนี้อิงกับเพดานจริงของ Plan ที่ผู้ใช้ตั้งไว้ (ดู tdBatchSize) — ได้ก้อนใหญ่สุดเท่าที่ยิงผ่าน
// ได้จริงเสมอ ทั้งบนแผนฟรีและแผนเสียเงิน และยังทำให้เช็คเงื่อนไข Fast Stop ได้ถี่ขึ้นด้วย
export const techScanBatchSize = () => tdBatchSize();
// จำนวนสัญลักษณ์ที่ยิง Finnhub (metric + company-news + social-sentiment + profile) พร้อมกันต่อ
// รอบ — ตอนนี้ Finnhub เป็นแหล่งข้อมูล "เกณฑ์บังคับหลัก" (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) จึง
// ต้องยิงให้ทุกตัวในพูลที่ยังไม่เจอผู้เข้าเกณฑ์ครบ ไม่ใช่แค่ตัวที่ผ่านเกณฑ์เทคนิคมาก่อนเหมือนเดิม
// หุ้น 1 ตัวใช้ 4 คำขอ (metric + news + social + profile) จึงคำนวณจากเพดานคำขอต่อนาทีของ Plan
// ที่ผู้ใช้ตั้งไว้จริง แทนค่าคงที่ที่ไม่สัมพันธ์กับโควตาเลย
export const fundScanBatchSize = () => Math.max(1, Math.floor(fhQueue.effectiveLimit() / 4));
// เก็บ "ผลสแกน" (ลิสต์หุ้นที่เข้าเกณฑ์) ของแต่ละสัปดาห์ไว้ใน localStorage โดยคีย์ด้วย weekKey
// เพื่อให้สแกนพูลทั้งหมดแค่ "ครั้งเดียวต่อสัปดาห์" — เปิดเว็บใหม่หรือสลับแท็บกี่ครั้งก็ตาม
// จะไม่ไล่สแกนพูลซ้ำอีก จนกว่าจะขึ้นสัปดาห์ใหม่ (weekKey เปลี่ยน) ถึงจะสแกนชุดใหม่โดยอัตโนมัติ
// อัปเดตเวอร์ชันคีย์เป็น v9 เพื่อล้างผลสแกนสัปดาห์เก่าที่คัดด้วยเกณฑ์ทางเทคนิค (Volume Surge +
// MA20/MA50) ทิ้งไปโดยอัตโนมัติ — บังคับให้สแกนใหม่ทั้งพูลด้วยเกณฑ์ "ความสนใจนักลงทุน + ปัจจัย
// พื้นฐาน" ชุดใหม่ทันที
export const WEEKLY_PICKS_STORE_KEY = "us-dash-weekly-picks-v9";
// จุดพักการสแกน (checkpoint) — เก็บ "ไล่สแกนไปถึงตำแหน่งไหนแล้ว" ของสัปดาห์ปัจจุบัน
// เหตุผล: พูลหุ้นมีหลักพันตัว แต่แผนฟรีของ Twelve Data มีแค่ 800 credit/วัน จึงเป็นไปไม่ได้เลย
// ที่จะสแกนจบในวันเดียว เดิมพอโควตาหมดกลางคัน ผลที่สแกนได้บางส่วนจะถูก "ล็อกไว้ทั้งสัปดาห์"
// (เพราะโค้ดบันทึกผลตอนจบฟังก์ชันเสมอ) ทำให้ทั้งสัปดาห์นั้นได้หุ้นไม่ครบและไม่มีทางสแกนต่อ
// ตอนนี้ถ้าหยุดเพราะโควตา จะบันทึกเป็น checkpoint แทน แล้ววันถัดไปสแกนต่อจากตำแหน่งเดิม
// จนกว่าจะครบ SCAN_BUFFER หรือหมดพูล ถึงจะล็อกผลจริง
export const SCAN_CHECKPOINT_KEY = "us-dash-scan-checkpoint-v2";

/* ------------------------------------------------------------
   เกณฑ์การคัดกรองหุ้นแนะนำประจำสัปดาห์ (v2) — "หุ้นกำลังเป็นเทรนด์ (Trending)" ที่มีโอกาสอยู่ใน
   ขาขึ้นรอบถัดไป คัดจากพูลหุ้นทั่วโลก (ดูหัวข้อ STOCK UNIVERSE ด้านบน)
   เดิมเกณฑ์บังคับคือสัญญาณทางเทคนิค (Volume Surge + MA20/MA50 + โมเมนตัมราคา) ตอนนี้ตัดออกแล้ว
   (computeTechnicalSignal ยังอยู่ในโค้ดแต่ใช้เป็น "ข้อมูลเสริม" แสดงผลบนการ์ดเฉย ๆ ไม่ใช่เกณฑ์
   คัดออกอีกต่อไป) แทนที่ด้วยเกณฑ์บังคับใหม่ 2 ข้อ (ต้องผ่านทั้งคู่) บวกความเสี่ยงที่แสดงเป็นคำเตือน:
     1) ความสนใจจากนักลงทุน (บังคับ) — ระบบนี้ไม่มี API เชื่อมโซเชียล/ฟอรัมลงทุนโดยตรง จึงประกอบ
        จาก 2 แหล่งของ Finnhub: (ก) จำนวนข่าวบริษัท (/company-news) ในช่วง NEWS_LOOKBACK_DAYS วัน
        ย้อนหลัง และ (ข) ยอดพูดถึงบน Reddit/Twitter (/stock/social-sentiment) ในช่วงเดียวกัน ผ่าน
        เกณฑ์นี้เมื่อจำนวนข่าว ≥ NEWS_MIN_COUNT หรือยอดพูดถึงโซเชียล ≥ SOCIAL_MIN_MENTIONS อย่างใด
        อย่างหนึ่ง (ดู computeInvestorInterest)
     2) ปัจจัยพื้นฐาน (บังคับ) — ผ่านเมื่อแนวโน้มรายได้ (Revenue Growth) หรือกำไร (EPS Growth) จาก
        Finnhub /stock/metric เป็นบวก หรืออยู่ใน sector/อุตสาหกรรมที่กำลังได้รับความสนใจ (ดู
        HOT_SECTOR_KEYWORDS เช่น เทคโนโลยี/AI/เซมิคอนดักเตอร์/พลังงานสะอาด/อิเล็กทรอนิกส์) หรือมี
        catalyst ที่คัดสรรไว้ล่วงหน้าใน TRENDING_UNIVERSE (ดู getFundamentalEligibility)
     3) ความเสี่ยง — คำนวณความผันผวนรายวัน (annualized, ถ้ามีข้อมูลราคาจาก Twelve Data) และเทียบ
        P/E กับเกณฑ์ทั่วไป เพื่อติดป้ายเตือนบนการ์ด (ดู getRiskFlags) ให้ผู้ใช้พิจารณาเอง ไม่ได้ใช้
        คัดหุ้นออกจากลิสต์ (เหมือนเดิม)
   จากหุ้นที่ผ่านเกณฑ์บังคับข้อ 1-2 ครบทั้งคู่ จะจัดอันดับด้วยคะแนนรวม (ดู computeTrendScore) ที่
   ให้น้ำหนักกับความแรงของความสนใจนักลงทุนมากที่สุด เสริมด้วยปัจจัยพื้นฐาน/catalyst และโมเมนตัม
   ราคา (ถ้ามีข้อมูลเทคนิค) แล้วคัด WEEKLY_PICK_COUNT ตัวสุดท้าย
   ------------------------------------------------------------ */
export const VOLUME_SURGE_MULTIPLIER = 1.5;   // ปริมาณซื้อขายล่าสุดต้องสูงกว่าค่าเฉลี่ย 20 วันอย่างน้อยกี่เท่า (ใช้แค่ข้อมูลเสริม ไม่ใช่เกณฑ์บังคับแล้ว)
export const MOMENTUM_WEEKS = 4;              // จำนวนสัปดาห์ย้อนหลังที่ใช้เช็คโมเมนตัมต่อเนื่อง
export const TRADING_DAYS_PER_WEEK = 5;       // ใช้แปลง "สัปดาห์" เป็นจำนวนแท่งราคารายวัน
export const MIN_POSITIVE_WEEKS = 3;          // จาก MOMENTUM_WEEKS สัปดาห์ ต้องเป็นสัปดาห์บวกอย่างน้อยกี่สัปดาห์
export const NEWS_LOOKBACK_DAYS = 7;          // นับข่าวบริษัท/ยอดพูดถึงโซเชียลกี่วันย้อนหลังเป็น "กระแสความสนใจ"
export const NEWS_MIN_COUNT = 2;              // จำนวนข่าว 7 วันขั้นต่ำที่ถือว่า "มีความสนใจจากนักลงทุน" (เกณฑ์บังคับข้อ 1)
export const SOCIAL_MIN_MENTIONS = 5;         // ยอดพูดถึงบน Reddit+Twitter รวม 7 วันขั้นต่ำ (เกณฑ์บังคับข้อ 1 ทางเลือก)
export const RISK_HIGH_VOLATILITY_PCT = 60;   // ความผันผวนรายปี (annualized) เกินกี่% ถือว่า "ผันผวนสูง"
export const RISK_HIGH_PE = 40;               // P/E TTM เกินกี่เท่า ถือว่า "สูงกว่าค่าเฉลี่ยอุตสาหกรรมทั่วไป"
// อุตสาหกรรม/sector ที่กำลังได้รับความสนใจตามที่ผู้ใช้ระบุ (เทคโนโลยี, AI, พลังงานสะอาด, อิเล็กทรอนิกส์
// ฯลฯ) จับคู่แบบ substring ไม่สนตัวพิมพ์เล็ก-ใหญ่ กับ sector ใน TRENDING_UNIVERSE หรือ
// finnhubIndustry จาก Finnhub /stock/profile2 ของหุ้นในพูลทั่วโลก
export const HOT_SECTOR_KEYWORDS = [
  "technology", "software", "semiconductor", "internet", "ai", "artificial intelligence",
  "cloud", "cybersecurity", "electronic", "renewable", "solar", "clean energy", "battery",
  "electric vehicle", "ev", "data center", "communications", "biotechnology",
];

// ค่าเฉลี่ยเคลื่อนที่แบบ SMA ธรรมดา (ไม่ใช่ EMA) ตามที่เกณฑ์ระบุ "เส้นค่าเฉลี่ยเคลื่อนที่ 20/50 วัน"
// — คืนค่าเฉพาะจุดสุดท้าย (ไม่ต้องคำนวณทั้งอาเรย์) เพื่อความเร็วระหว่างสแกนพูลขนาดใหญ่
export function smaLast(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// วิเคราะห์แท่งราคา "รายวัน" ของหุ้นหนึ่งตัว เพื่อเช็คเกณฑ์ Volume + โมเมนตัมราคา (ข้อ 1-2)
// ต้องมีแท่งราคาย้อนหลังอย่างน้อย 51 แท่ง (50 วันสำหรับ MA50 + 1 วันปัจจุบัน) ไม่งั้นถือว่าข้อมูล
// ไม่พอสำหรับสแกน (คืนค่า null แล้วผู้เรียกจะตัดสัญลักษณ์นี้ออกไปโดยอัตโนมัติ)
export function computeTechnicalSignal(bars) {
  if (!bars || bars.length < 51) return null;
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const n = closes.length;
  const last = n - 1;

  const price = closes[last];
  const ma20 = smaLast(closes, 20);
  const ma50 = smaLast(closes, 50);
  const aboveMA20 = ma20 != null && price > ma20;
  const aboveMA50 = ma50 != null && price > ma50;

  // ปริมาณซื้อขายล่าสุดเทียบกับค่าเฉลี่ย 20 วัน "ก่อนหน้า" (ไม่รวมแท่งล่าสุดเอง กันไม่ให้ปริมาณ
  // ของวันนี้ไปดันค่าเฉลี่ยของตัวเองให้สูงขึ้นจนสัดส่วนคลาดเคลื่อน)
  const lastVolume = volumes[last];
  const avgVolume20 = smaLast(volumes.slice(0, last), 20);
  const volumeRatio = avgVolume20 && avgVolume20 > 0 ? lastVolume / avgVolume20 : null;
  const volumeSurge = volumeRatio != null && volumeRatio >= VOLUME_SURGE_MULTIPLIER;

  // โมเมนตัมราคาต่อเนื่อง 1-4 สัปดาห์ — แบ่งเป็นสัปดาห์ละ TRADING_DAYS_PER_WEEK แท่ง แล้วเช็คว่า
  // ในบรรดา MOMENTUM_WEEKS สัปดาห์ล่าสุด เป็นสัปดาห์ที่ราคาปิดบวก (เทียบสัปดาห์ก่อนหน้า) อย่าง
  // น้อย MIN_POSITIVE_WEEKS สัปดาห์ และผลรวมทั้งช่วงต้องเป็นบวกด้วย (ตัดเคส "สัปดาห์นี้บวกทีเดียว
  // หลังจากลงมาต่อเนื่อง" ที่ยังไม่ถือว่าเป็นเทรนด์ขาขึ้นจริง)
  const weeklyReturns = [];
  for (let w = 0; w < MOMENTUM_WEEKS; w++) {
    const idxRecent = last - w * TRADING_DAYS_PER_WEEK;
    const idxPrior = last - (w + 1) * TRADING_DAYS_PER_WEEK;
    if (idxPrior < 0) break;
    const recentClose = closes[idxRecent];
    const priorClose = closes[idxPrior];
    weeklyReturns.push(priorClose ? ((recentClose - priorClose) / priorClose) * 100 : null);
  }
  const positiveWeeks = weeklyReturns.filter((r) => r != null && r > 0).length;
  const idx4wAgo = last - MOMENTUM_WEEKS * TRADING_DAYS_PER_WEEK;
  const change4w = idx4wAgo >= 0 && closes[idx4wAgo] ? ((price - closes[idx4wAgo]) / closes[idx4wAgo]) * 100 : null;
  const change1w = weeklyReturns.length > 0 ? weeklyReturns[0] : null;
  const continuousUptrend =
    weeklyReturns.length === MOMENTUM_WEEKS && positiveWeeks >= MIN_POSITIVE_WEEKS && change4w != null && change4w > 0;

  // ความผันผวนรายวัน (20 วันล่าสุด) แปลงเป็นค่ารายปี (annualized) แบบเดียวกับที่ใช้ในวงการเงิน
  // ทั่วไป (stdev รายวัน x sqrt(252)) เพื่อใช้แสดงเป็นคำเตือนความเสี่ยงบนการ์ด
  let volatilityPct = null;
  if (n >= 21) {
    const dailyReturns = [];
    for (let i = last - 19; i <= last; i++) {
      if (i <= 0) continue;
      const prev = closes[i - 1];
      if (prev) dailyReturns.push((closes[i] - prev) / prev);
    }
    if (dailyReturns.length >= 10) {
      const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / dailyReturns.length;
      volatilityPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
    }
  }

  const technicalEligible = volumeSurge && aboveMA20 && aboveMA50 && continuousUptrend;

  return {
    price, ma20, ma50, aboveMA20, aboveMA50,
    volumeRatio, volumeSurge, lastVolume, avgVolume20,
    weeklyReturns, positiveWeeks, change1w, change4w, continuousUptrend,
    volatilityPct, technicalEligible,
  };
}

// ดึงจำนวนข่าวบริษัท (Finnhub /company-news) ในช่วง NEWS_LOOKBACK_DAYS วันย้อนหลัง — ใช้เป็น
// ตัวแทน "ความสนใจจากนักลงทุน" (ข้อ 3) เพราะระบบนี้ไม่มี API เชื่อมกับโซเชียล/ฟอรัมลงทุนโดยตรง
export async function fetchCompanyNewsCount7d(symbol, fhKey) {
  if (!fhKey) return null;
  const cached = readFhCache("news", symbol);
  if (cached !== undefined) return cached;
  return fhSingleFlight(`news:${symbol}`, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const url = `${FH_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${fhKey}`;
    const { data } = await fhRequest(url, { priority: PRIORITY.BACKGROUND });
    const count = Array.isArray(data) ? data.length : 0;
    writeFhCache("news", symbol, count);
    return count;
  }).catch(() => null);
}

// ดึงยอดพูดถึงบน Reddit/Twitter (Finnhub /stock/social-sentiment) ในช่วง NEWS_LOOKBACK_DAYS วัน
// ย้อนหลัง — ใช้ประกอบเป็น "ความสนใจจากนักลงทุน" (ข้อ 1) คู่กับจำนวนข่าว เพราะระบบนี้ไม่มี API
// เชื่อมโซเชียล/ฟอรัมลงทุนโดยตรง endpoint นี้เป็นของแผนพรีเมียมของ Finnhub — ถ้าบัญชีไม่มีสิทธิ์
// เข้าถึง (403/ไม่มีข้อมูล) จะคืนค่า null เงียบ ๆ แล้วเกณฑ์ข้อ 1 จะพิจารณาจากจำนวนข่าวอย่างเดียว
export async function fetchSocialSentiment7d(symbol, fhKey) {
  if (!fhKey) return null;
  const cached = readFhCache("social", symbol);
  if (cached !== undefined) return cached;
  return fhSingleFlight(`social:${symbol}`, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const url = `${FH_BASE}/stock/social-sentiment?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${fhKey}`;
    const { data } = await fhRequest(url, { priority: PRIORITY.BACKGROUND });
    const reddit = Array.isArray(data?.reddit) ? data.reddit : [];
    const twitter = Array.isArray(data?.twitter) ? data.twitter : [];
    const sumMentions = (arr) => arr.reduce((s, d) => s + (d?.mention || 0), 0);
    const sumScore = (arr) => arr.reduce((s, d) => s + (d?.score || 0), 0);
    const mentions = sumMentions(reddit) + sumMentions(twitter);
    const posts = reddit.length + twitter.length;
    const avgScore = posts > 0 ? (sumScore(reddit) + sumScore(twitter)) / posts : null;
    const result = { mentions, avgScore };
    writeFhCache("social", symbol, result);
    return result;
  }).catch(() => null);
}

// ดึงตัวเลขแนวโน้มพื้นฐาน (การเติบโตของรายได้/กำไร + P/E) จาก object metric ของ Finnhub — ใช้
// pick() ลองหลายชื่อฟิลด์เผื่อ Finnhub เปลี่ยนชื่อฟิลด์หรือบางสัญลักษณ์ไม่มีบางฟิลด์
export function getGrowthSignals(fundamentals) {
  if (!fundamentals) return { revenueGrowth: null, epsGrowth: null, peTTM: null };
  const revenueGrowth = pick(fundamentals, [
    "revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy", "revenueGrowth5Y", "revenueGrowth3Y",
  ]);
  const epsGrowth = pick(fundamentals, [
    "epsGrowthTTMYoy", "epsGrowthQuarterlyYoy", "epsGrowth5Y", "epsGrowth3Y",
  ]);
  const peTTM = pick(fundamentals, [
    "peTTM", "peBasicExclExtraTTM", "peExclExtraTTM", "peInclExtraTTM", "peNormalizedAnnual",
  ]);
  return { revenueGrowth, epsGrowth, peTTM };
}

// ป้ายเตือนความเสี่ยง (ข้อ 3) — แสดงผลบนการ์ดเฉย ๆ ไม่ใช้คัดหุ้นออกจากลิสต์ เพราะหุ้นเทรนด์แรง
// ส่วนใหญ่ผันผวนสูงและ P/E สูงเป็นเรื่องปกติอยู่แล้วโดยธรรมชาติของหุ้นกลุ่มนี้ — tech เป็น
// optional (ไม่มีข้อมูลราคาก็ยังแสดงป้าย P/E ได้ตามปกติ)
export function getRiskFlags(tech, growth) {
  const flags = [];
  if (tech?.volatilityPct != null && tech.volatilityPct > RISK_HIGH_VOLATILITY_PCT) {
    flags.push(`ผันผวนสูง (~${tech.volatilityPct.toFixed(0)}%/ปี)`);
  }
  if (growth?.peTTM != null && growth.peTTM > RISK_HIGH_PE) {
    flags.push(`P/E สูง (${growth.peTTM.toFixed(1)}x)`);
  }
  return flags;
}

// เกณฑ์บังคับข้อ 1 — "ความสนใจจากนักลงทุน" ผ่านเมื่อจำนวนข่าว 7 วัน ≥ NEWS_MIN_COUNT หรือยอด
// พูดถึงบนโซเชียล 7 วัน ≥ SOCIAL_MIN_MENTIONS อย่างใดอย่างหนึ่ง (social อาจเป็น null ถ้าบัญชี
// Finnhub ไม่มีสิทธิ์เข้าถึง endpoint พรีเมียม — เกณฑ์จะพิจารณาจากข่าวอย่างเดียวในกรณีนั้น)
export function computeInvestorInterest(newsCount, social) {
  const mentions = social?.mentions ?? null;
  const byNews = newsCount != null && newsCount >= NEWS_MIN_COUNT;
  const bySocial = mentions != null && mentions >= SOCIAL_MIN_MENTIONS;
  return { newsCount, mentions, avgScore: social?.avgScore ?? null, eligible: byNews || bySocial };
}

// จับคู่ sector/อุตสาหกรรมกับ HOT_SECTOR_KEYWORDS แบบ substring ไม่สนตัวพิมพ์เล็ก-ใหญ่
export function isHotSector(sectorStr) {
  if (!sectorStr) return false;
  const s = sectorStr.toLowerCase();
  return HOT_SECTOR_KEYWORDS.some((kw) => s.includes(kw));
}

// เกณฑ์บังคับข้อ 2 — "ปัจจัยพื้นฐาน" ผ่านเมื่อรายได้/กำไรเติบโตเป็นบวก หรืออยู่ใน sector ที่กำลัง
// ได้รับความสนใจ หรือมี catalyst ที่คัดสรรไว้ล่วงหน้าใน TRENDING_UNIVERSE — อย่างใดอย่างหนึ่ง
export function getFundamentalEligibility({ growth, sector, hasCatalyst }) {
  const growthPositive =
    (growth?.revenueGrowth != null && growth.revenueGrowth > 0) ||
    (growth?.epsGrowth != null && growth.epsGrowth > 0);
  const hotSector = isHotSector(sector);
  return { growthPositive, hotSector, eligible: growthPositive || hotSector || !!hasCatalyst };
}

// คะแนนรวมสำหรับจัดอันดับหุ้นที่ผ่านเกณฑ์บังคับ (ความสนใจนักลงทุน + ปัจจัยพื้นฐาน) แล้ว —
// น้ำหนักมากสุดให้กับความแรงของความสนใจนักลงทุน (ข่าว + โซเชียล, เกณฑ์บังคับข้อ 1) เสริมด้วย
// ปัจจัยพื้นฐานเป็นบวก/sector ร้อนแรง/catalyst (เกณฑ์บังคับข้อ 2) และท้ายสุดเสริมเล็กน้อยด้วย
// โมเมนตัมราคา (tech) ถ้ามีข้อมูล — ยิ่งคะแนนรวมสูง ยิ่งน่าสนใจกว่า
export function computeTrendScore({ tech, growth, newsCount, mentions, growthPositive, hotSector, hasCatalyst }) {
  let score = 0;
  if (newsCount != null) score += Math.min(newsCount, 15) * 4;
  if (mentions != null) score += Math.min(mentions, 200) * 0.3;
  if (growthPositive) score += 20;
  if (hotSector) score += 10;
  if (hasCatalyst) score += 10;
  // โมเมนตัมราคา/Volume เป็นข้อมูลเสริม (ไม่บังคับ) ถ้ามีข้อมูลจาก Twelve Data ก็ให้คะแนนเพิ่มเล็กน้อย
  if (tech?.volumeRatio != null) score += Math.min(tech.volumeRatio, 5) * 5;
  if (tech?.change4w != null) score += Math.max(0, Math.min(tech.change4w, 50)) * 0.4;
  return score;
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
// แทบไม่มีทางผ่านเกณฑ์ Volume Surge เลย ส่วนหุ้นคัดสรร (TRENDING_UNIVERSE) ที่โอกาสผ่านสูงสุด
// กลับถูกไล่สแกนเป็นกลุ่มท้ายสุด = เผาโควตาไปหลายร้อย credit ก่อนจะเจอตัวแรก
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
