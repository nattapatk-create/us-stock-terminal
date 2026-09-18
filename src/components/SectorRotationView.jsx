import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { PRIORITY, loadStore, saveStore } from "../api/quotaEngine.js";
import { fetchQuoteBalanced, fetchSeriesBatch } from "../api/priceSeries.js";
import { SECTOR_ETFS } from "../data/sectorEtfs.js";
import { SECTOR_AUTO_REFRESH_MS, SECTOR_CACHE_TTL_MS, SECTOR_STALE_WARN_MS } from "../data/sp500Universe.js";
import { AlertTriangle, PieChart, Radar, RefreshCw, X } from "./icons.jsx";
import { fmtPct, fmtPrice, formatRelativeTime } from "../utils/formatters.js";
import { StockLogo } from "./StockLogo.jsx";

// สแกนอัตโนมัติแค่ครั้งเดียวต่อการเปิดหน้าเว็บหนึ่งรอบ (ไม่ผูกกับ state ของคอมโพเนนต์ เพราะ
// ต้องอยู่ยันข้าม mount/unmount ถ้าผู้ใช้สลับแท็บไปมา)
let sectorAutoScanned = false;

export const SectorRotationView = memo(function SectorRotationView({ tdKey }) {
  const [sectorData, setSectorData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [scannedAt, setScannedAt] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  // ใช้ tick นี้แค่บังคับ re-render ทุก 30 วิ เพื่อให้ข้อความ "x นาทีที่แล้ว" ขยับตามเวลาจริง
  const [, setTick] = useState(0);

  const [sortField, setSortField] = useState("score");
  const [sortAsc, setSortAsc] = useState(false);

  // สแกนเร็วขึ้น (แก้รอบ 2 — จุดบอดจริงคือ "จำนวนคำขอ" ไม่ใช่แค่การรอซ้อนทับกัน):
  // รอบก่อนหน้าเปลี่ยนจากยิงทีละตัวเรียงลำดับ มาเป็น "ส่งเข้าคิวพร้อมกันทีเดียว" ด้วย Promise.all
  // ซึ่งช่วยตัดเวลาปิ๊งปั๊งเครือข่ายที่ซ้อนทับกันได้จริง แต่คิว tdQueue ก็ยังนับ SPY + 11 sector
  // ETF เป็น "12 คำขอแยกกัน" อยู่ดี และต้องเรียงคิวห่างกันตาม tdMinIntervalMs (~7.7 วินาทีบน
  // แพ็กเกจฟรี) ทำให้รวมแล้วยังใช้เวลา 12 x ~7.7s ≈ 90+ วินาทีต่อการสแกน 1 ครั้งอยู่ดี
  // ตอนนี้รวม SPY + sector ETF ทั้งหมดเป็น "คำขอ HTTP เดียว" ผ่าน fetchSeriesBatch (ใช้ฟีเจอร์
  // batch ของ Twelve Data ที่รับหลายสัญลักษณ์คั่นด้วย comma ในคำขอเดียว) คิวจึงเห็นเป็นแค่ 1
  // รายการ ไม่ต้องรอเรียงคิว 12 รอบเหมือนเดิม (เสีย credit เท่าเดิมคือ 12 แต่ไม่เสียเวลาเข้าคิว)
  const scanSectors = useCallback(async () => {
    if (!tdKey || !tdKey.trim()) {
      setError("โปรดใส่ Twelve Data API key ในเมนู ⚙ เพื่อเริ่มการสแกนอัตโนมัติ");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      const allSymbols = ["SPY", ...SECTOR_ETFS.map((sec) => sec.symbol)];
      const seriesMap = await fetchSeriesBatch(allSymbols, tdKey, "1week", 70, { priority: PRIORITY.NORMAL });
      setProgress(100);

      const spySeries = seriesMap["SPY"];
      if (!spySeries) {
        console.warn("Couldn't fetch SPY, using absolute sector metrics.");
      }
      const sectorResults = SECTOR_ETFS.map((sec) => ({ sec, series: seriesMap[sec.symbol] || null }));

      const spyReturns = spySeries && spySeries.length >= 20 ? {
        r1w: ((spySeries[spySeries.length - 1].close - spySeries[spySeries.length - 2].close) / spySeries[spySeries.length - 2].close) * 100,
        r1m: ((spySeries[spySeries.length - 1].close - spySeries[Math.max(0, spySeries.length - 5)].close) / spySeries[Math.max(0, spySeries.length - 5)].close) * 100,
        r3m: ((spySeries[spySeries.length - 1].close - spySeries[0].close) / spySeries[0].close) * 100,
      } : { r1w: 0, r1m: 0, r3m: 0 };

      const results = [];
      for (const { sec, series } of sectorResults) {
        if (series && series.length >= 12) {
          const len = series.length;
          const pNow = series[len - 1].close;
          const p1w = series[Math.max(0, len - 2)].close;
          const p1m = series[Math.max(0, len - 5)].close;
          const p3m = series[0].close;

          const r1w = ((pNow - p1w) / p1w) * 100;
          const r1m = ((pNow - p1m) / p1m) * 100;
          const r3m = ((pNow - p3m) / p3m) * 100;

          const rel1w = r1w - spyReturns.r1w;
          const rel1m = r1m - spyReturns.r1m;
          const rel3m = r3m - spyReturns.r3m;

          let quadrant = "Lagging";
          if (rel1m >= 0 && rel1w >= 0) quadrant = "Leading";
          else if (rel1m >= 0 && rel1w < 0) quadrant = "Weakening";
          else if (rel1m < 0 && rel1w >= 0) quadrant = "Improving";
          else quadrant = "Lagging";

          const score = (rel1w * 0.4) + (rel1m * 0.4) + (rel3m * 0.2);

          results.push({
            ...sec,
            price: pNow,
            r1w, r1m, r3m,
            rel1w, rel1m, rel3m,
            quadrant,
            score
          });
        }
      }

      results.sort((a, b) => b.score - a.score);
      const now = Date.now();
      setSectorData(results);
      setScannedAt(now);
      saveStore("us-dash-sector-data", { items: results, scannedAt: now });
    } catch (e) {
      setError(e.message || "เกิดข้อผิดพลาดในการโหลดข้อมูล Sector");
    } finally {
      setLoading(false);
    }
  }, [tdKey]);

  // โหลดแคชที่มีอยู่ก่อน แล้วสแกนใหม่อัตโนมัติเฉพาะตอนที่ข้อมูล "เก่าเกินไปแล้วจริง ๆ"
  // (เดิมใช้ตัวแปร sectorAutoScanned สแกนอัตโนมัติแค่ครั้งเดียวต่อการโหลดหน้าเว็บ ไม่สนอายุ
  // ข้อมูลเลย — พอรีเฟรชหน้าถี่ ๆ ก็ยิง API ซ้ำทั้งที่ข้อมูลยังสดอยู่ หรือถ้าเปิดแท็บค้างไว้นาน
  // ข้อมูลก็เก่ามากโดยไม่มีการเตือนหรือรีเฟรชให้เลย)
  useEffect(() => {
    let cancelled = false;
    loadStore("us-dash-sector-data", null).then((cached) => {
      if (cancelled || !cached) return;
      // รองรับข้อมูลแคชแบบเก่า (เป็น array ล้วน ไม่มี timestamp) เพื่อไม่ให้ผู้ใช้เดิมเสียข้อมูล
      const items = Array.isArray(cached) ? cached : cached.items;
      const ts = Array.isArray(cached) ? null : cached.scannedAt;
      if (items && items.length) {
        setSectorData(items);
        setScannedAt(ts || null);
      }

      const age = ts ? Date.now() - ts : Infinity;
      if (tdKey && tdKey.trim() && !sectorAutoScanned && age >= SECTOR_CACHE_TTL_MS) {
        sectorAutoScanned = true;
        scanSectors();
      }
    });
    return () => { cancelled = true; };
  }, [tdKey, scanSectors]);

  // แสดงเวลาแบบสัมพัทธ์ให้ขยับเองทุก 30 วิ โดยไม่ต้องยิง API ใหม่ (แค่ re-render ข้อความ)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // โหมด Auto-refresh: สแกนซ้ำอัตโนมัติทุก SECTOR_AUTO_REFRESH_MS ตราบเท่าที่ยังเปิดหน้านี้ค้างไว้
  // และมี API key แล้ว ช่วยให้ข้อมูล Sector Rotation ทันสมัยต่อเนื่องโดยไม่ต้องกดสแกนเอง
  useEffect(() => {
    if (!autoRefresh || !tdKey || !tdKey.trim()) return undefined;
    const id = setInterval(() => scanSectors(), SECTOR_AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, tdKey, scanSectors]);

  const dataAgeMs = scannedAt ? Date.now() - scannedAt : null;
  const isStale = dataAgeMs != null && dataAgeMs >= SECTOR_STALE_WARN_MS;

  const sortedSectorData = useMemo(() => {
    return [...sectorData].sort((a, b) => {
      const valA = a[sortField] ?? 0;
      const valB = b[sortField] ?? 0;
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [sectorData, sortField, sortAsc]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const quadrants = useMemo(() => {
    const groups = { Leading: [], Weakening: [], Improving: [], Lagging: [] };
    sectorData.forEach((s) => {
      if (groups[s.quadrant]) groups[s.quadrant].push(s);
    });
    return groups;
  }, [sectorData]);

  const QUAD_STYLE = {
    Leading: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    Weakening: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    Improving: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    Lagging: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-base flex items-center gap-2">
            <PieChart className="text-emerald-400" size={18} />
            Sector Rotation Radar (Twelve Data Realtime)
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            เปรียบเทียบความแข็งแกร่งสัมพัทธ์ (Relative Strength) ของ 11 Sectors เทียบกับ S&P 500 (SPY)
          </div>
          {scannedAt && (
            <div className={`text-[11px] mt-1.5 flex items-center gap-1.5 ${isStale ? "text-amber-400" : "text-zinc-500"}`}>
              {isStale && <AlertTriangle size={11} className="shrink-0" />}
              <span>
                อัปเดตล่าสุด {formatRelativeTime(scannedAt)}
                {isStale ? " • ข้อมูลอาจไม่ทันสมัย กดสแกนใหม่อีกครั้ง" : ""}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-500"
            />
            Auto-refresh ทุก 20 นาที
          </label>
          <button
            onClick={scanSectors}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white font-medium text-xs hover:bg-blue-500 disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? `กำลังสแกนเรียลไทม์... (${progress}%)` : "สแกน Sector อัปเดตใหม่"}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="text-sm font-semibold text-zinc-200 mb-3 flex items-center justify-between">
          <span>🎯 Sector Rotation Matrix</span>
          <span className="text-xs font-normal text-zinc-500">แกน X: โมเมนตัม 1W | แกน Y: แนวโน้ม 1M</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-zinc-950/80 border border-blue-500/30 rounded p-3 relative min-h-[120px]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
              <span className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span> IMPROVING (กำลังฟื้นตัว)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quadrants.Improving.map((s) => (
                <span key={s.symbol} className="text-xs bg-blue-500/10 border border-blue-500/30 text-blue-300 font-mono px-2 py-1 rounded flex items-center gap-1.5">
                  <StockLogo symbol={s.symbol} size={16} />
                  <span>{s.symbol}</span>
                  <span className="text-[10px] opacity-80">{fmtPct(s.rel1w)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-emerald-500/40 rounded p-3 relative min-h-[120px]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> LEADING (ผู้นำตลาด)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quadrants.Leading.map((s) => (
                <span key={s.symbol} className="text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono px-2 py-1 rounded font-medium flex items-center gap-1.5">
                  <StockLogo symbol={s.symbol} size={16} />
                  <span>{s.symbol}</span>
                  <span className="text-[10px] opacity-80">{fmtPct(s.rel1w)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-red-500/30 rounded p-3 relative min-h-[120px]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
              <span className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400"></span> LAGGING (ล้าหลัง)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quadrants.Lagging.map((s) => (
                <span key={s.symbol} className="text-xs bg-red-500/10 border border-red-500/30 text-red-300 font-mono px-2 py-1 rounded flex items-center gap-1.5">
                  <StockLogo symbol={s.symbol} size={16} />
                  <span>{s.symbol}</span>
                  <span className="text-[10px] opacity-80">{fmtPct(s.rel1w)}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-amber-500/30 rounded p-3 relative min-h-[120px]">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
              <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span> WEAKENING (เริ่มชะลอตัว)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quadrants.Weakening.map((s) => (
                <span key={s.symbol} className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono px-2 py-1 rounded flex items-center gap-1.5">
                  <StockLogo symbol={s.symbol} size={16} />
                  <span>{s.symbol}</span>
                  <span className="text-[10px] opacity-80">{fmtPct(s.rel1w)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-x-auto">
        <div className="text-sm font-semibold text-zinc-200 mb-3 flex flex-wrap items-center justify-between gap-2">
          <span>📊 ตารางสรุปข้อมูลทั้ง 11 Sectors</span>
          <div className="flex items-center gap-2 text-xs font-normal">
            <span className="text-zinc-400">การจัดเรียง:</span>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-blue-400 border border-zinc-700 flex items-center gap-1 font-mono text-[11px]"
            >
              {sortAsc ? "⬆️ เงินไหลเข้าน้อย → มาก" : "⬇️ เงินไหลเข้ามาก → น้อย"}
            </button>
          </div>
        </div>

        {loading && sectorData.length === 0 ? (
          <div className="text-center text-zinc-400 py-8 text-xs flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin text-blue-400" /> กำลังดึงข้อมูล Sector เรียลไทม์... ({progress}%)
          </div>
        ) : sortedSectorData.length === 0 ? (
          <div className="text-center text-zinc-500 py-8 text-xs">
            ไม่พบข้อมูล โปรดตรวจสอบ API Key ในเมนู ⚙ แล้วกดปุ่มสแกน
          </div>
        ) : (
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="pb-2">Sector / ETF</th>
                <th className="pb-2 text-right">ราคา</th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('r1w')}>
                  1W (%) {sortField === 'r1w' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('r1m')}>
                  1M (%) {sortField === 'r1m' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('rel1w')}>
                  VS SPY (1W) {sortField === 'rel1w' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="pb-2 text-center">สถานะ Quadrant</th>
                <th className="pb-2 text-right cursor-pointer hover:text-zinc-200 select-none" onClick={() => handleSort('score')}>
                  RS Score (เงินไหลเข้า) {sortField === 'score' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {sortedSectorData.map((s) => (
                <tr key={s.symbol} className="hover:bg-zinc-800/40 transition">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      <StockLogo symbol={s.symbol} size={28} />
                      <div>
                        <div className="font-bold text-zinc-100 font-mono">{s.symbol}</div>
                        <div className="text-[10px] text-zinc-400 font-sans">{s.thName} ({s.name})</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right font-bold text-zinc-200">${fmtPrice(s.price)}</td>
                  <td className={`py-2.5 text-right ${s.r1w >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(s.r1w)}</td>
                  <td className={`py-2.5 text-right ${s.r1m >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(s.r1m)}</td>
                  <td className={`py-2.5 text-right ${s.rel1w >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(s.rel1w)}</td>
                  <td className="py-2.5 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${QUAD_STYLE[s.quadrant]}`}>
                      {s.quadrant}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-bold text-zinc-100">{s.score ? s.score.toFixed(1) : "0.0"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});


/* ============================================================
   S&P 500 HEATMAP — Treemap สไตล์ finviz แยกตาม GICS Sector
   ------------------------------------------------------------
   ต่างจาก Sector Rotation Radar (ที่ใช้ ETF ตัวแทน 11 sector) หน้านี้ดึงราคาล่าสุดของ
   หุ้นรายตัวทั้งหมดในดัชนี (503 symbols ตาม Wikipedia) แล้วจัดกลุ่มตาม GICS Sector ให้เห็น
   ภาพรวมว่าหุ้นตัวไหน/หมวดไหนกำลังเขียว-แดง ณ ขณะนี้ — พื้นที่ของแต่ละ tile และแต่ละกล่อง
   sector สัมพันธ์กับขนาดบริษัท (ประมาณ market cap) เหมือน finviz ไม่ใช่ตารางขนาดเท่ากันทุกช่อง

   ออกแบบให้ประหยัดโควตา API และไม่ค้างหน้าจอ:
   • ใช้ fetchQuoteBalanced() ตัวเดิมที่มีอยู่แล้ว (เลือกเส้นทาง Finnhub/Twelve Data ตาม
     ความว่างจริง ณ ขณะนั้น) ยิงพร้อมกันทีเดียวทั้ง 503 สัญลักษณ์ แล้วปล่อยให้คิว
     rate-limiter ที่มีอยู่แล้วในแอป (tdQueue/fhQueue) เป็นตัวควบคุมจังหวะยิงจริงเอง
     ไม่ต้องเขียนตัวหน่วงเวลาซ้ำซ้อนขึ้นมาใหม่
   • ไม่ใช้ Promise.all() รอให้ครบทุกตัวก่อนแสดงผล เพราะบนแผนฟรี Finnhub (60 คำขอ/นาที)
     การสแกนทั้งตลาดอาจกินเวลาหลายนาที — แต่ละสัญลักษณ์ที่ได้ผลลัพธ์กลับมาจะถูก flush เข้า
     state เป็นช่วง ๆ (ทุก ~800ms) ผู้ใช้จึงเห็น tile ทยอยขึ้นสีตามจริงแทนที่จะรอจนจบ
   • แคชผลลัพธ์ล่าสุดไว้ใน localStorage (TTL เดียวกับ Sector Rotation) กันต้องสแกนใหม่ทุกครั้ง
     ที่สลับแท็บหรือรีเฟรชหน้า
   • ขนาด tile คำนวณจาก "น้ำหนัก" คงที่ต่อสัญลักษณ์ (ประมาณ market cap หยาบ ๆ ไม่อิง realtime)
     จึงไม่กระโดดไปมาเวลาข้อมูลราคาทยอยมาถึง — มีแค่สีที่เปลี่ยนจากเทา (ยังไม่มีข้อมูล) เป็น
     เขียว/แดงตามเปอร์เซ็นต์เปลี่ยนแปลงเมื่อสแกนเสร็จ
   ============================================================ */
