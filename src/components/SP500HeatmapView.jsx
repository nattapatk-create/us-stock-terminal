import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SP500_ALL_SYMBOLS, SP500_SECTOR_TH, SP500_UNIVERSE } from "../data/sp500Universe.js";
import { PRIORITY, loadStore, saveStore } from "../api/quotaEngine.js";
import { fetchQuoteBalanced } from "../api/priceSeries.js";
import { HEADER_H, HEATMAP_CACHE_KEY, HEATMAP_STALE_WARN_MS, SECTOR_GAP, TREEMAP_H, TREEMAP_W, heatTileStyle, squarify, tileWeight } from "../utils/heatmapLayout.js";
import { AlertTriangle, Grid3x3, RefreshCw, Search } from "./icons.jsx";
import { fmtPct, formatRelativeTime } from "../utils/formatters.js";
import { StockLogo } from "./StockLogo.jsx";

export const SP500HeatmapView = memo(function SP500HeatmapView({ tdKey, fhKey, onAdd }) {
  const [quotes, setQuotes] = useState({});      // symbol -> {percent_change, close, ...} | undefined ระหว่างยังไม่มา
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [scannedAt, setScannedAt] = useState(null);
  const [, setTick] = useState(0);

  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [addedFlash, setAddedFlash] = useState(null);
  const [hover, setHover] = useState(null); // { tile, x, y } พิกัดตามเมาส์จริง สำหรับ tooltip ลอย

  const scanRef = useRef({ token: 0 });

  const scanHeatmap = useCallback(async () => {
    if ((!tdKey || !tdKey.trim()) && (!fhKey || !fhKey.trim())) {
      setError("โปรดใส่ Twelve Data หรือ Finnhub API key ในเมนู ⚙ ก่อนสแกน Heatmap");
      return;
    }
    const myToken = ++scanRef.current.token;
    setLoading(true);
    setError(null);
    const total = SP500_ALL_SYMBOLS.length;
    setProgress({ done: 0, total });

    const collected = {};
    let done = 0;
    const flush = () => {
      if (scanRef.current.token !== myToken) return;
      setQuotes({ ...collected });
    };
    const flushTimer = setInterval(flush, 800);

    try {
      await Promise.all(SP500_ALL_SYMBOLS.map(async (sym) => {
        try {
          const q = await fetchQuoteBalanced(sym, { tdKey, fhKey, priority: PRIORITY.BACKGROUND });
          if (q) collected[sym] = q;
        } catch (e) {
          // สัญลักษณ์ตัวเดียวพังไม่ควรทำให้การสแกนทั้งก้อนหยุด (ข้ามไปเก็บว่าง)
        } finally {
          done += 1;
          if (scanRef.current.token === myToken) setProgress({ done, total });
        }
      }));

      if (scanRef.current.token === myToken) {
        const now = Date.now();
        flush();
        setScannedAt(now);
        saveStore(HEATMAP_CACHE_KEY, { quotes: collected, scannedAt: now });
      }
    } finally {
      clearInterval(flushTimer);
      if (scanRef.current.token === myToken) setLoading(false);
    }
  }, [tdKey, fhKey]);

  // โหลดแคชที่มีอยู่ก่อน แล้วสแกนใหม่อัตโนมัติเฉพาะเมื่อยังไม่เคยมีข้อมูลหรือข้อมูลเก่าเกินไป
  useEffect(() => {
    let cancelled = false;
    loadStore(HEATMAP_CACHE_KEY, null).then((cached) => {
      if (cancelled || !cached) return;
      if (cached.quotes && Object.keys(cached.quotes).length) {
        setQuotes(cached.quotes);
        setScannedAt(cached.scannedAt || null);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const dataAgeMs = scannedAt ? Date.now() - scannedAt : null;
  const isStale = dataAgeMs != null && dataAgeMs >= HEATMAP_STALE_WARN_MS;
  const hasAnyData = Object.keys(quotes).length > 0;

  // สร้างรายการต่อ sector พร้อม %change + น้ำหนัก(ขนาด tile) ของแต่ละตัว และผลรวมของทั้ง sector
  const sectorRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return Object.entries(SP500_UNIVERSE).map(([sector, list]) => {
      let items = list.map(([sym, name]) => {
        const quote = quotes[sym];
        const pct = quote ? +quote.percent_change : null;
        return { sym, name, pct, close: quote ? +quote.close : null, weight: tileWeight(sym) };
      });
      if (q) items = items.filter((it) => it.sym.includes(q) || it.name.toUpperCase().includes(q));

      const withData = items.filter((it) => it.pct != null);
      const avg = withData.length ? withData.reduce((s, it) => s + it.pct, 0) / withData.length : null;
      const advancers = withData.filter((it) => it.pct > 0).length;
      const decliners = withData.filter((it) => it.pct < 0).length;
      const weight = items.reduce((s, it) => s + it.weight, 0);
      return { sector, items, avg, advancers, decliners, total: list.length, withData: withData.length, weight };
    }).filter((row) => row.items.length > 0);
  }, [quotes, search]);

  const visibleSectorRows = sectorFilter === "ALL" ? sectorRows : sectorRows.filter((r) => r.sector === sectorFilter);

  // ผัง treemap สองชั้น: ชั้นนอกจัดกล่อง sector ตามน้ำหนักรวม แล้วชั้นในจัด tile ของแต่ละหุ้น
  // ภายในกล่อง sector ของตัวเอง (เว้นแถบหัวข้อด้านบนไว้) — คำนวณครั้งเดียวต่อการเปลี่ยนแปลง
  // ข้อมูล/ตัวกรอง ไม่ผูกกับการสแกนแต่ละรอบ จึงไม่มีเลย์เอาต์กระโดดไปมาเวลาสีทยอยอัปเดต
  const treemapLayout = useMemo(() => {
    if (!visibleSectorRows.length) return [];
    const sectorRects = squarify(
      visibleSectorRows.map((r) => ({ sector: r.sector, weight: r.weight })),
      0, 0, TREEMAP_W, TREEMAP_H
    );
    const bySector = Object.fromEntries(visibleSectorRows.map((r) => [r.sector, r]));
    return sectorRects.map((rect) => {
      const row = bySector[rect.sector];
      const innerX = rect.x + SECTOR_GAP / 2;
      const innerY = rect.y + HEADER_H;
      const innerW = Math.max(0, rect.w - SECTOR_GAP);
      const innerH = Math.max(0, rect.h - HEADER_H - SECTOR_GAP / 2);
      const tiles = squarify(row.items, innerX, innerY, innerW, innerH);
      return { ...row, rect, tiles };
    });
  }, [visibleSectorRows]);

  const marketBreadth = useMemo(() => {
    const all = Object.entries(quotes).map(([sym, quote]) => +quote.percent_change).filter((n) => !Number.isNaN(n));
    if (!all.length) return null;
    const advancers = all.filter((n) => n > 0).length;
    const decliners = all.filter((n) => n < 0).length;
    const unchanged = all.length - advancers - decliners;
    const avg = all.reduce((s, n) => s + n, 0) / all.length;
    let bestSym = null, bestPct = -Infinity, worstSym = null, worstPct = Infinity;
    for (const [sym, quote] of Object.entries(quotes)) {
      const pct = +quote.percent_change;
      if (Number.isNaN(pct)) continue;
      if (pct > bestPct) { bestPct = pct; bestSym = sym; }
      if (pct < worstPct) { worstPct = pct; worstSym = sym; }
    }
    return { count: all.length, advancers, decliners, unchanged, avg, bestSym, bestPct, worstSym, worstPct };
  }, [quotes]);

  const handleTileClick = (sym) => {
    if (typeof onAdd === "function") {
      onAdd(sym);
      setAddedFlash(sym);
      setTimeout(() => setAddedFlash((cur) => (cur === sym ? null : cur)), 900);
    }
  };

  const showTooltip = (tile, e) => setHover({ tile, x: e.clientX, y: e.clientY });

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-base flex items-center gap-2">
            <Grid3x3 className="text-blue-400" size={18} />
            S&amp;P 500 Heatmap
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            ราคาล่าสุดของหุ้นทั้ง 503 ตัวในดัชนี S&amp;P 500 จัดกลุ่มตาม GICS Sector ขนาดกล่อง
            อิงมูลค่าบริษัทโดยประมาณ — วางเมาส์บน tile เพื่อดูโลโก้/ชื่อ/เปอร์เซ็นต์ คลิกเพื่อเพิ่มเข้า Watchlist
          </div>
          {scannedAt && (
            <div className={`text-[11px] mt-1.5 flex items-center gap-1.5 ${isStale ? "text-amber-400" : "text-zinc-500"}`}>
              {isStale && <AlertTriangle size={11} className="shrink-0" />}
              <span>
                ข้อมูลล่าสุด {formatRelativeTime(scannedAt)}
                {isStale && " (อาจไม่ทันสมัย — กด สแกนใหม่)"}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scanHeatmap}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white font-medium flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {loading ? `กำลังสแกน ${progress.done}/${progress.total}` : hasAnyData ? "สแกนใหม่" : "เริ่มสแกน Heatmap"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
            />
          </div>
          <div className="text-[10px] text-zinc-500 mt-1.5">
            กำลังดึงราคาล่าสุดทีละสัญลักษณ์ผ่านคิวจำกัดอัตรา (Finnhub/Twelve Data) — tile จะทยอยขึ้นสีเมื่อข้อมูลมาถึง
            ใช้เวลาสักครู่ถึงหลายนาทีขึ้นกับโควตา API ของคุณ
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {marketBreadth && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center gap-4 text-xs">
          <div className="text-zinc-400">
            สแกนแล้ว <span className="text-zinc-100 font-mono">{marketBreadth.count}</span>/{SP500_ALL_SYMBOLS.length}
          </div>
          <div className="text-emerald-400">▲ ขึ้น {marketBreadth.advancers}</div>
          <div className="text-red-400">▼ ลง {marketBreadth.decliners}</div>
          <div className="text-zinc-500">ไม่เปลี่ยน {marketBreadth.unchanged}</div>
          <div className={marketBreadth.avg >= 0 ? "text-emerald-400" : "text-red-400"}>
            เฉลี่ย {fmtPct(marketBreadth.avg)}
          </div>
          {marketBreadth.bestSym && (
            <div className="text-zinc-400">
              สูงสุด <span className="text-emerald-400 font-mono">{marketBreadth.bestSym} {fmtPct(marketBreadth.bestPct)}</span>
            </div>
          )}
          {marketBreadth.worstSym && (
            <div className="text-zinc-400">
              ต่ำสุด <span className="text-red-400 font-mono">{marketBreadth.worstSym} {fmtPct(marketBreadth.worstPct)}</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2 text-zinc-500" />
          <input
            type="text"
            placeholder="ค้นหา Symbol หรือชื่อบริษัท..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded pl-8 pr-2 py-1 text-xs text-zinc-100 w-48 focus:w-64 transition-all"
          />
        </div>
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-300 font-mono"
        >
          <option value="ALL">ทุก Sector ({SP500_ALL_SYMBOLS.length})</option>
          {Object.keys(SP500_UNIVERSE).map((sec) => (
            <option key={sec} value={sec}>
              {SP500_SECTOR_TH[sec]} · {sec} ({SP500_UNIVERSE[sec].length})
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 ml-auto">
          <span>-3%</span>
          <div
            className="w-24 h-2 rounded-full"
            style={{ background: "linear-gradient(to right, hsl(358 85% 40%), hsl(358 55% 16%), #1e1f33, hsl(152 55% 16%), hsl(152 85% 40%))" }}
          />
          <span>+3%</span>
        </div>
      </div>

      {!hasAnyData && !loading && !error && (
        <div className="text-center text-zinc-500 py-16 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
          ยังไม่มีข้อมูล — กด "เริ่มสแกน Heatmap" ด้านบนเพื่อดึงราคาล่าสุดของหุ้นทั้ง 503 ตัว
        </div>
      )}

      {treemapLayout.length === 0 && hasAnyData && (
        <div className="text-center text-zinc-500 py-12 bg-zinc-900 border border-zinc-800 rounded-lg text-xs">
          ไม่พบหุ้นตรงตามเงื่อนไขค้นหา
        </div>
      )}

      {treemapLayout.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 sm:p-2">
          <div
            className="relative w-full"
            style={{ aspectRatio: `${TREEMAP_W} / ${TREEMAP_H}`, minHeight: 420 }}
            onMouseLeave={() => setHover(null)}
          >
            {treemapLayout.map((s) => (
              <div
                key={s.sector}
                className="absolute overflow-hidden"
                style={{
                  left: `${(s.rect.x / TREEMAP_W) * 100}%`,
                  top: `${(s.rect.y / TREEMAP_H) * 100}%`,
                  width: `${(s.rect.w / TREEMAP_W) * 100}%`,
                  height: `${(s.rect.h / TREEMAP_H) * 100}%`,
                }}
              >
                <div
                  className="absolute left-0 right-0 top-0 flex items-center justify-between gap-1 px-1.5"
                  style={{ height: `${Math.min(100, (HEADER_H / s.rect.h) * 100)}%` }}
                >
                  <span className="text-[10px] sm:text-xs font-semibold text-zinc-300 truncate">
                    {SP500_SECTOR_TH[s.sector] || s.sector}
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-zinc-600 shrink-0">›</span>
                </div>
                {s.tiles.map((tile) => {
                  const style = heatTileStyle(tile.pct);
                  const leftPct = ((tile.x - s.rect.x) / s.rect.w) * 100;
                  const topPct = ((tile.y - s.rect.y) / s.rect.h) * 100;
                  const wPct = (tile.w / s.rect.w) * 100;
                  const hPct = (tile.h / s.rect.h) * 100;
                  const area = tile.w * tile.h; // พื้นที่หน่วยเสมือน ใช้ประมาณว่า tile นี้ "ใหญ่พอ" จะโชว์อะไรได้บ้าง
                  const justAdded = addedFlash === tile.sym;
                  return (
                    <button
                      key={tile.sym}
                      type="button"
                      onClick={() => handleTileClick(tile.sym)}
                      onMouseEnter={(e) => showTooltip(tile, e)}
                      onMouseMove={(e) => showTooltip(tile, e)}
                      onMouseLeave={() => setHover(null)}
                      title={`${tile.sym} — ${tile.name}${tile.pct != null ? ` (${fmtPct(tile.pct)})` : " (ยังไม่มีข้อมูล)"} · คลิกเพื่อเพิ่มเข้า Watchlist`}
                      style={{ position: "absolute", left: `${leftPct}%`, top: `${topPct}%`, width: `${wPct}%`, height: `${hPct}%`, padding: "1px" }}
                      className="appearance-none border-0 bg-transparent cursor-pointer group"
                    >
                      <div
                        style={style}
                        className={`w-full h-full rounded-[3px] flex flex-col items-center justify-center overflow-hidden transition-transform duration-100 group-hover:scale-[1.05] group-hover:z-20 group-hover:shadow-xl ${justAdded ? "ring-2 ring-white" : ""}`}
                      >
                        {area > 9000 && (
                          <StockLogo symbol={tile.sym} size={area > 32000 ? 28 : 18} className="mb-0.5 pointer-events-none" />
                        )}
                        {area > 2200 && (
                          <div
                            className="font-mono font-bold leading-tight truncate px-0.5 pointer-events-none"
                            style={{ fontSize: area > 32000 ? 13 : area > 9000 ? 11 : 9 }}
                          >
                            {tile.sym}
                          </div>
                        )}
                        {area > 4200 && (
                          <div
                            className="font-mono leading-tight opacity-90 pointer-events-none"
                            style={{ fontSize: area > 32000 ? 11 : 9 }}
                          >
                            {tile.pct != null ? fmtPct(tile.pct) : "…"}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {hover && typeof window !== "undefined" && (
        <div
          className="fixed z-50 pointer-events-none bg-zinc-950 border border-zinc-700 rounded-lg shadow-2xl px-3 py-2 flex items-center gap-2.5"
          style={{
            left: Math.min(hover.x + 16, window.innerWidth - 230),
            top: Math.min(hover.y + 16, window.innerHeight - 74),
          }}
        >
          <StockLogo symbol={hover.tile.sym} size={30} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
              <span className="font-mono">{hover.tile.sym}</span>
              <span className="text-zinc-500 font-normal truncate max-w-[160px]">{hover.tile.name}</span>
            </div>
            <div className={`text-sm font-mono font-bold ${hover.tile.pct == null ? "text-zinc-500" : hover.tile.pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {hover.tile.pct != null ? fmtPct(hover.tile.pct) : "ยังไม่มีข้อมูล"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

