export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let count = 0, sum = 0, seedIdx = -1, prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { count = 0; sum = 0; continue; }
    if (seedIdx === -1) {
      count++; sum += v;
      if (count === period) {
        seedIdx = i;
        prev = sum / period; // seed = SMA ของ `period` แท่งแรกที่มีข้อมูลครบ
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0, loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const signal = ema(line.map((v) => (v == null ? 0 : v)), 9);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

export function findSwings(bars, window = 5) {
  const highs = [], lows = [];
  for (let i = window; i < bars.length - window; i++) {
    const slice = bars.slice(i - window, i + window + 1);
    if (bars[i].high === Math.max(...slice.map((b) => b.high))) highs.push({ price: bars[i].high, idx: i });
    if (bars[i].low === Math.min(...slice.map((b) => b.low))) lows.push({ price: bars[i].low, idx: i });
  }
  return { highs, lows };
}

export function clusterLevels(points, tolerancePct, totalBars) {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  sorted.forEach((p) => {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last.avg) / last.avg <= tolerancePct) {
      last.prices.push(p.price);
      last.idxs.push(p.idx);
      last.avg = last.prices.reduce((a, b) => a + b, 0) / last.prices.length;
    } else {
      clusters.push({ avg: p.price, prices: [p.price], idxs: [p.idx] });
    }
  });
  return clusters.map((c) => ({
    price: c.avg,
    touches: c.prices.length,
    strength: c.prices.length * 2 + (Math.max(...c.idxs) / totalBars),
  }));
}

export function getSupportResistance(bars, currentPrice) {
  if (!bars || bars.length < 20) return { support: [], resistance: [] };
  const { highs, lows } = findSwings(bars, 5);
  const tolerance = 0.0002;

  const resistance = clusterLevels(highs, tolerance, bars.length)
    .filter((c) => c.price > currentPrice * 1.0001)
    .sort((a, b) => b.touches - a.touches || b.strength - a.strength)
    .slice(0, 3)
    .sort((a, b) => a.price - b.price);

  const support = clusterLevels(lows, tolerance, bars.length)
    .filter((c) => c.price < currentPrice * 0.9999)
    .sort((a, b) => b.touches - a.touches || b.strength - a.strength)
    .slice(0, 3)
    .sort((a, b) => a.price - b.price);

  return { support, resistance };
}

// ============================================================
// Chaikin Money Flow (CMF) — ประมาณ "แรงซื้อ/ขายจากเงินทุนก้อนใหญ่ (รายใหญ่)"
// โดยดูว่าราคาปิดแต่ละแท่งอยู่ค่อนไปทาง High หรือ Low ของช่วงนั้น (Accumulation/Distribution
// Multiplier) แล้วถ่วงน้ำหนักด้วยปริมาณซื้อขาย (Volume) สะสมเป็นค่าเฉลี่ยตามคาบเวลา (period)
// ค่าเป็นบวกต่อเนื่อง = มีแรงซื้อสะสม/เงินทุนไหลเข้า ค่าเป็นลบ = แรงขายสะสม/เงินทุนไหลออก
// ============================================================
export function computeCMF(bars, period = 20) {
  const n = bars.length;
  const mfv = bars.map((b) => {
    const range = b.high - b.low;
    if (!range) return 0;
    const moneyFlowMultiplier = ((b.close - b.low) - (b.high - b.close)) / range;
    return moneyFlowMultiplier * (b.volume || 0);
  });
  const cmfArr = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sumMfv = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMfv += mfv[j];
      sumVol += bars[j].volume || 0;
    }
    cmfArr[i] = sumVol > 0 ? sumMfv / sumVol : 0;
  }
  return cmfArr;
}

export function classify(bars) {
  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const price = closes[last];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rsiArr = rsi(closes, 14);
  const { hist } = macd(closes);
  const rsiVal = rsiArr[last];
  const h = hist[last], hPrev = hist[last - 1];
  // เดิมเช็คแค่ closes.length > 200 (จำนวนแท่งทั้งหมด) ซึ่งไม่รับประกันว่า ema(closes,200)
  // จะคำนวณค่าออกมาได้จริง (ฟังก์ชัน ema แบบ SMA-seeded ต้องการ 200 แท่ง "ต่อเนื่องไม่มีช่องว่าง")
  // เช็คจากผลลัพธ์จริง e200[last] != null แม่นยำกว่าและกันเคส EMA200 เป็น null หลุดไปแสดงผลผิด
  const has200 = e200[last] != null;

  let trend = "Sideways", trendScore = 0;
  if (e20[last] != null && e50[last] != null) {
    const alignedUp = price > e20[last] && e20[last] > e50[last] && (!has200 || e50[last] > e200[last]);
    const alignedDown = price < e20[last] && e20[last] < e50[last] && (!has200 || e50[last] < e200[last]);
    if (alignedUp) { trend = "Uptrend"; trendScore = 2; }
    else if (price > e50[last]) { trend = "Uptrend"; trendScore = 1; }
    else if (alignedDown) { trend = "Downtrend"; trendScore = -2; }
    else if (price < e50[last]) { trend = "Downtrend"; trendScore = -1; }
  }

  let momentum = "Neutral";
  if (rsiVal != null && h != null && hPrev != null) {
    if (rsiVal > 60 && h > hPrev) momentum = "Strong Bullish";
    else if (rsiVal > 50 && h > 0) momentum = "Bullish";
    else if (rsiVal < 40 && h < hPrev) momentum = "Strong Bearish";
    else if (rsiVal < 50 && h < 0) momentum = "Bearish";
  }

  // เงินทุนรายใหญ่ (CMF) — เช็คว่ากำลัง "ไหลเข้าต่อเนื่อง" หรือไม่ โดยเทียบค่า CMF ปัจจุบัน
  // กับค่า CMF เมื่อ ~4 แท่งก่อนหน้า ถ้าค่าเพิ่มขึ้นเกิน threshold เล็กน้อย (กันสัญญาณหลอก/noise)
  // ถือว่าแรงซื้อสะสมกำลังเพิ่มขึ้นต่อเนื่อง ไม่ใช่แค่บวกครั้งเดียวแล้วแผ่ว
  const cmfArr = computeCMF(bars, 20);
  const cmf = cmfArr[last];
  const cmfLookbackIdx = Math.max(0, last - 4);
  const cmfPrev = cmfArr[cmfLookbackIdx];
  const cmfRising = cmf != null && cmfPrev != null && (cmf - cmfPrev) > 0.01;

  // แนวรับสำคัญ — หาแนวรับที่ใกล้ราคาปัจจุบันที่สุด (จากแท่งราคาทั้งหมด) แล้ววัดระยะห่างเป็น %
  // เพื่อเช็คว่าราคา "กำลังถึง" แนวรับหรือยัง (ยังไม่หลุดแนวรับ แต่เข้าใกล้มากแล้ว)
  let supportDistPct = null, nearestSupportPrice = null;
  const { support: supportLevels } = getSupportResistance(bars, price);
  if (supportLevels.length > 0) {
    const closestSupport = supportLevels.reduce((best, s) => (s.price > best.price ? s : best), supportLevels[0]);
    nearestSupportPrice = closestSupport.price;
    supportDistPct = ((price - closestSupport.price) / price) * 100;
  }

  return {
    trend, trendScore, momentum, rsi: rsiVal, macdHist: h,
    e20: e20[last], e50: e50[last], e200: has200 ? e200[last] : null, price,
    cmf, cmfRising, supportDistPct, nearestSupportPrice,
  };
}

// ============================================================
// ประสิทธิภาพ: classify() คำนวณหนัก (EMA 3 เส้น + RSI + MACD + CMF + หาแนวรับ-แนวต้าน) แต่ถูก
// เรียกซ้ำ ๆ กับ series เดิม ๆ จากหลายจุดพร้อมกัน (การ์ด Watchlist แต่ละใบ, ตัวกรอง Trend ของ
// Watchlist, ตัวสแกนหุ้นแนะนำประจำสัปดาห์ที่ loop ทั้งพูลทุกครั้งที่มีข้อมูลสัญลักษณ์ไหนก็ตาม
// อัปเดต) ทั้งที่ผลลัพธ์จะเหมือนเดิมทุกครั้งถ้า series (แท่งราคา) ไม่ได้เปลี่ยนจริง ๆ
// ในแอปนี้ series ถูก "แทนที่ทั้งก้อน" เสมอเวลาข้อมูลเปลี่ยน (ไม่เคย push/splice แก้ในที่เดิม)
// จึงใช้ WeakMap แคชผลลัพธ์โดยอิง reference ของ array เป็นคีย์ได้อย่างปลอดภัย — ถ้า series
// อาเรย์เดิมถูกเรียกซ้ำ จะได้ผลลัพธ์จากแคชทันทีโดยไม่คำนวณอินดิเคเตอร์ใหม่เลย และเมื่อไม่มีใคร
// อ้างอิง series อาเรย์นั้นแล้ว (ถูกแทนที่ด้วยข้อมูลใหม่) Garbage Collector จะเก็บกวาดแคชทิ้งเอง
// โดยอัตโนมัติ ไม่ต้องจัดการ cache invalidation เอง — ทุกจุดในแอปควรเรียก classifyCached()
// แทน classify() ตรง ๆ (ยกเว้นในนิยามฟังก์ชัน classify เอง)
// ============================================================
export const classifyCache = new WeakMap();
export function classifyCached(bars) {
  if (!bars) return null;
  const cached = classifyCache.get(bars);
  if (cached) return cached;
  const result = classify(bars);
  classifyCache.set(bars, result);
  return result;
}

/* ============================================================
   API LAYER
   ============================================================ */
// จำนวนแท่งที่ดึงต่อ Timeframe — เดิมใช้ 220 แท่งตายตัวทุก interval ซึ่งไม่พอสำหรับ EMA200
// (ฟังก์ชัน ema ต้องเห็น 200 แท่งก่อนจะเริ่ม "seed" ได้ เหลือ margin แค่ ~20 แท่งให้ EMA200
// ลู่เข้าค่าจริง ทำให้ตัวเลขคลาดเคลื่อนจากแพลตฟอร์มอื่นได้มาก) เพิ่ม buffer ให้มากพอ:
// - 1day: 500 แท่ง (~200 แท่งสำหรับ seed + ~300 แท่ง buffer ให้ EMA200 ลู่เข้า)
// - 1week: 300 แท่ง (~200 สัปดาห์สำหรับ seed + ~100 สัปดาห์ buffer)
export const OUTPUTSIZE_BY_INTERVAL = { "1day": 500, "1week": 300 };
// จำนวนแท่งรายวันที่ "ตัวสแกน" ต้องใช้จริง — computeTechnicalSignal ต้องการอย่างน้อย 51 แท่ง
// (MA50 + แท่งปัจจุบัน) ส่วนโมเมนตัม 4 สัปดาห์ใช้ 21 แท่ง และ volatility ใช้ 21 แท่ง เท่ากับ
// 70 แท่งพอเหลือเฟือ เดิมสแกนด้วย outputsize=500 ทำให้แต่ละคำขอลากข้อมูลมาเกินความจำเป็น ~7 เท่า
// (ก้อนละ 8 สัญลักษณ์ = 4,000 แท่ง ≈ 500KB JSON ต่อคำขอ) เปลืองทั้งเวลาเน็ตและเวลา parse ฝั่ง
// เบราว์เซอร์ โดยไม่ประหยัด credit เพิ่มเลย (Twelve Data คิด credit ตามจำนวนสัญลักษณ์ ไม่ใช่
// จำนวนแท่ง) — ลดเหลือ 70 แท่งจึงเร็วขึ้นมากโดยผลการคัดกรองเหมือนเดิมทุกประการ
export const SCAN_OUTPUTSIZE = 70;
export const MIN_BARS_FOR_FULL_INDICATORS = 20; // ต่ำกว่านี้ยังพอมองเทรนด์คร่าว ๆ ได้ แต่ EMA/RSI/MACD จะไม่ครบ

