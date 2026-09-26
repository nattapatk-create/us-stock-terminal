import { SP500_WEIGHT } from "../data/sp500Weights.js";

export function heatTileStyle(pct) {
  if (pct == null || Number.isNaN(pct)) {
    return { background: "#1e1f33", color: "#71717a" };
  }
  const t = Math.min(1, Math.abs(pct) / 3); // อิ่มตัวเต็มที่ที่ ±3%
  const light = 16 + t * 24;   // 16%..40%
  const sat = 55 + t * 30;     // 55%..85%
  const hue = pct >= 0 ? 152 : 358;
  return {
    background: `hsl(${hue} ${sat}% ${light}%)`,
    color: t > 0.3 ? "#f8fafc" : "#d4d4d8",
  };
}

export const HEATMAP_CACHE_KEY = "us-dash-sp500-heatmap";
export const HEATMAP_CACHE_TTL_MS = 15 * 60 * 1000;   // 15 นาที ถือว่ายังสดพอ (ราคาหุ้นรายตัว)
export const HEATMAP_STALE_WARN_MS = 30 * 60 * 1000;

// น้ำหนักสัมพัทธ์ต่อสัญลักษณ์ (ประมาณ market cap หน่วยพันล้านดอลลาร์ แบบคร่าว ๆ) — ใช้เพื่อ
// กำหนด "พื้นที่" ของแต่ละ tile ในผัง treemap เท่านั้น ไม่ใช่ตัวเลขที่ต้องแม่นยำหรืออัปเดต
// realtime (คล้ายวิธีที่ finviz ใช้ market cap จัดขนาดกล่อง) ตัวที่ไม่ได้ระบุไว้จะได้น้ำหนัก
// เล็ก ๆ แบบสุ่มคงที่ (จาก hash ของชื่อย่อ) กันไม่ให้ตารางดูจืดเป็นช่องเท่ากันหมด

export function defaultTileWeight(sym) {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return 6 + ((h % 1000) / 1000) * 14; // ~6..20 — ให้หุ้นเล็กที่ไม่ได้ระบุยังมีขนาดต่างกันบ้าง
}
export function tileWeight(sym) {
  return SP500_WEIGHT[sym] || defaultTileWeight(sym);
}

// อัลกอริทึม Squarified Treemap มาตรฐาน (Bruls, Huizing & van Wijk, 2000) — จัดรายการที่มี
// .weight ให้เป็นสี่เหลี่ยมเรียงเต็มพื้นที่ (x, y, w, h) ที่กำหนด โดยพยายามให้แต่ละกล่องมี
// สัดส่วนใกล้เคียงสี่เหลี่ยมจัตุรัสที่สุด (อ่านง่ายกว่าเป็นแท่งยาวเรียว)
export function squarify(items, x, y, w, h) {
  const filtered = items.filter((it) => it.weight > 0);
  if (!filtered.length || w <= 0 || h <= 0) return [];
  const total = filtered.reduce((s, it) => s + it.weight, 0);
  if (!total) return [];
  const scale = (w * h) / total;
  const sorted = [...filtered].sort((a, b) => b.weight - a.weight);
  const results = [];
  let cx = x, cy = y, cw = w, ch = h;
  let row = [], rowSum = 0;

  const areaOf = (it) => it.weight * scale;
  const worst = (rowArr, sum) => {
    const side = Math.min(cw, ch);
    const sumArea = sum * scale;
    let maxA = -Infinity, minA = Infinity;
    for (const it of rowArr) {
      const a = areaOf(it);
      if (a > maxA) maxA = a;
      if (a < minA) minA = a;
    }
    const s2 = side * side;
    return Math.max((s2 * maxA) / (sumArea * sumArea), (sumArea * sumArea) / (s2 * minA));
  };
  const layoutRow = (rowArr, sum) => {
    const sumArea = sum * scale;
    if (cw >= ch) {
      const rowW = sumArea / ch;
      let oy = cy;
      for (const it of rowArr) {
        const a = areaOf(it);
        const rh = a / rowW;
        results.push({ ...it, x: cx, y: oy, w: rowW, h: rh });
        oy += rh;
      }
      cx += rowW; cw -= rowW;
    } else {
      const rowH = sumArea / cw;
      let ox = cx;
      for (const it of rowArr) {
        const a = areaOf(it);
        const rw = a / rowH;
        results.push({ ...it, x: ox, y: cy, w: rw, h: rowH });
        ox += rw;
      }
      cy += rowH; ch -= rowH;
    }
  };

  let i = 0;
  while (i < sorted.length) {
    const item = sorted[i];
    const newRow = [...row, item];
    const newSum = rowSum + item.weight;
    if (row.length === 0 || worst(newRow, newSum) <= worst(row, rowSum)) {
      row = newRow; rowSum = newSum; i++;
    } else {
      layoutRow(row, rowSum);
      row = []; rowSum = 0;
    }
  }
  if (row.length) layoutRow(row, rowSum);
  return results;
}

// ขนาดผ้าใบเสมือน (virtual canvas) ที่ใช้คำนวณ treemap — container จริงจะถูกล็อกอัตราส่วน
// ด้วย CSS aspect-ratio ให้ตรงกับค่านี้เสมอ ดังนั้นสัดส่วน % ที่คำนวณจากพิกัดเสมือนนี้จะตรงกับ
// พิกเซลจริงบนจอเสมอไม่ว่าจอกว้างแค่ไหน (การ scale สม่ำเสมอไม่ทำให้สัดส่วนเพี้ยน)
export const TREEMAP_W = 1600;
export const TREEMAP_H = 900;
export const SECTOR_GAP = 5;
export const HEADER_H = 30;
