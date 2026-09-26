import { STOCK_INFO_MAP } from "../data/stockInfo.js";

export function getStockName(symbol, profileName) {
  if (profileName && profileName.trim()) return profileName;
  if (symbol && STOCK_INFO_MAP[symbol.toUpperCase()]?.name) return STOCK_INFO_MAP[symbol.toUpperCase()].name;
  return symbol || "";
}

// ลำดับความสำคัญของแหล่งโลโก้ (แก้รอบ 3 — สาเหตุจริงของ "โลโก้ SpaceX ไม่เปลี่ยน"):
// รอบก่อนหน้าตั้งใจให้โดเมนที่ยืนยันเองใน STOCK_INFO_MAP (ผ่าน Clearbit) ชนะทุกแหล่งเสมอ แต่
// "Clearbit Logo API" (logo.clearbit.com) ถูกปิดถาวรไปแล้วตั้งแต่ 8 ธ.ค. 2025 — คำขอไปยัง
// โดเมนนี้จะต่อไม่ติดเลย (ไม่ใช่แค่ตอบโลโก้ผิด) ดังนั้นสำหรับทุก symbol ที่มี curatedDomain
// (รวมถึง SPCX/SpaceX) ตัวเลือกแรกในลิสต์จะ error ทันทีเสมอ แล้วค่อยไปเข้าคิว fallback ถัดไป
// ซึ่งบางทีก็เป็นโลโก้เก่า/ผิดจากผู้ให้บริการอื่นที่ยังไม่อัปเดต — เข้าใจผิดว่า "โลโก้ยังไม่เปลี่ยน"
// ทั้งที่จริง ๆ ตัวที่ควรเปลี่ยน (Clearbit) ใช้งานไม่ได้แล้วตั้งแต่ต้น
// แก้โดยเปลี่ยนมาใช้ Google Favicon service แทน Clearbit สำหรับโดเมนที่เรายืนยันเอง — ยังคงเป็น
// บริการฟรีไม่ต้องใช้ API key เหมือนเดิม และยังคง "โดเมนที่ตรงกับบริษัทจริง" เป็นแหล่งที่แม่นยำ
// ที่สุดเช่นเดิม แล้วค่อยไล่ profileLogo (Finnhub) → parqet → financialmodelingprep ตามลำดับ
// ความน่าเชื่อถือที่ลดลง เผื่อ favicon ของบางโดเมนคุณภาพไม่พอ
export function getLogoUrls(symbol, profileLogo) {
  const list = [];
  const cleanSym = symbol ? symbol.toUpperCase() : "";
  const curatedDomain = cleanSym ? STOCK_INFO_MAP[cleanSym]?.domain : null;
  if (curatedDomain) list.push(`https://www.google.com/s2/favicons?sz=128&domain=${curatedDomain}`);
  if (profileLogo) list.push(profileLogo);
  if (cleanSym) {
    list.push(`https://assets.parqet.com/logos/symbol/${cleanSym}`);
    list.push(`https://images.financialmodelingprep.com/symbol/${cleanSym}.png`);
  }
  return list;
}


export const fmtPrice = (n) => (n == null || isNaN(n) ? "—" : n.toFixed(2));
export const fmtPct = (n) => (n == null || isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
// ย่อตัวเลขจำนวนผู้ติดตาม/ผู้พูดถึงบน StockTwits ให้อ่านง่าย เช่น 12345 -> "12.3K"
export const fmtCompactNum = (n) => (n == null || isNaN(n) ? "—" : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n));
export const fmtBig = (n) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
};

// แสดงเวลาแบบสัมพัทธ์ (เช่น "2 นาทีที่แล้ว") ใช้กับข้อมูลที่ต้องบอกความสดใหม่ให้ผู้ใช้เห็นชัด
// (เดิมแอปมี timestamp เก็บอยู่แล้ว (cachedAt/scannedAt) แต่ไม่เคยแสดงผลบน UI เลย)
export function formatRelativeTime(ts) {
  if (!ts) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "เมื่อสักครู่";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 15) return "เมื่อสักครู่";
  if (sec < 60) return `${sec} วินาทีที่แล้ว`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  return `${day} วันที่แล้ว`;
}

export const TREND_STYLE = {
  Uptrend: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  Downtrend: "text-red-400 bg-red-500/10 border-red-500/30",
  Sideways: "text-amber-400 bg-amber-500/10 border-amber-500/30",
};
export const MOM_STYLE = {
  "Strong Bullish": "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 font-bold",
  Bullish: "text-emerald-300 bg-emerald-500/5 border-emerald-500/20",
  Neutral: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
  Bearish: "text-red-300 bg-red-500/5 border-red-500/20",
  "Strong Bearish": "text-red-400 bg-red-500/10 border-red-500/30",
};
export const TREND_TH = { Uptrend: "ขาขึ้น", Downtrend: "ขาลง", Sideways: "แกว่งตัว" };
export const MOM_TH = {
  "Strong Bullish": "โมเมนตัมบวกแรง 🔥", Bullish: "โมเมนตัมบวก", Neutral: "เป็นกลาง",
  Bearish: "โมเมนตัมลบ", "Strong Bearish": "โมเมนตัมลบแรง",
};

/* ============================================================
   WEEKLY RECOMMENDED PICKS (10 STOCKS - STRONG BULLISH ONLY)
   ============================================================ */
export const COUNTRY_META = {
  US: { name: "สหรัฐฯ", flag: "🇺🇸", region: "อเมริกาเหนือ" },
  CA: { name: "แคนาดา", flag: "🇨🇦", region: "อเมริกาเหนือ" },
  NL: { name: "เนเธอร์แลนด์", flag: "🇳🇱", region: "ยุโรป" },
  DK: { name: "เดนมาร์ก", flag: "🇩🇰", region: "ยุโรป" },
  DE: { name: "เยอรมนี", flag: "🇩🇪", region: "ยุโรป" },
  GB: { name: "สหราชอาณาจักร", flag: "🇬🇧", region: "ยุโรป" },
  BE: { name: "เบลเยียม", flag: "🇧🇪", region: "ยุโรป" },
  FR: { name: "ฝรั่งเศส", flag: "🇫🇷", region: "ยุโรป" },
  IT: { name: "อิตาลี", flag: "🇮🇹", region: "ยุโรป" },
  SE: { name: "สวีเดน", flag: "🇸🇪", region: "ยุโรป" },
  FI: { name: "ฟินแลนด์", flag: "🇫🇮", region: "ยุโรป" },
  TW: { name: "ไต้หวัน", flag: "🇹🇼", region: "เอเชีย" },
  CN: { name: "จีน", flag: "🇨🇳", region: "เอเชีย" },
  JP: { name: "ญี่ปุ่น", flag: "🇯🇵", region: "เอเชีย" },
  IN: { name: "อินเดีย", flag: "🇮🇳", region: "เอเชีย" },
  KR: { name: "เกาหลีใต้", flag: "🇰🇷", region: "เอเชีย" },
  SG: { name: "สิงคโปร์", flag: "🇸🇬", region: "เอเชีย" },
  AU: { name: "ออสเตรเลีย", flag: "🇦🇺", region: "โอเชียเนีย" },
  AR: { name: "อาร์เจนตินา", flag: "🇦🇷", region: "ลาตินอเมริกา" },
  BR: { name: "บราซิล", flag: "🇧🇷", region: "ลาตินอเมริกา" },
  CH: { name: "สวิตเซอร์แลนด์", flag: "🇨🇭", region: "ยุโรป" },
  ES: { name: "สเปน", flag: "🇪🇸", region: "ยุโรป" },
  NO: { name: "นอร์เวย์", flag: "🇳🇴", region: "ยุโรป" },
  IE: { name: "ไอร์แลนด์", flag: "🇮🇪", region: "ยุโรป" },
  MX: { name: "เม็กซิโก", flag: "🇲🇽", region: "ลาตินอเมริกา" },
  CL: { name: "ชิลี", flag: "🇨🇱", region: "ลาตินอเมริกา" },
  CO: { name: "โคลอมเบีย", flag: "🇨🇴", region: "ลาตินอเมริกา" },
  IL: { name: "อิสราเอล", flag: "🇮🇱", region: "ตะวันออกกลาง" },
  ZA: { name: "แอฟริกาใต้", flag: "🇿🇦", region: "แอฟริกา" },
};
export function getCountryMeta(code) {
  return COUNTRY_META[code] || { name: code || "ไม่ทราบ", flag: "🌐", region: "อื่นๆ" };
}

