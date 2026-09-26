import { memo, useMemo, useState } from "react";
import { TIMEFRAMES } from "../data/appConfig.js";
import { MIN_BARS_FOR_FULL_INDICATORS, classifyCached, getSupportResistance } from "../utils/indicators.js";
import { MOM_STYLE, MOM_TH, TREND_STYLE, TREND_TH, fmtBig, fmtPct, fmtPrice, formatRelativeTime, getStockName } from "../utils/formatters.js";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Trash2 } from "./icons.jsx";
import { StockLogo } from "./StockLogo.jsx";
import { PriceChart } from "./PriceChart.jsx";
import { WatchlistCalculator } from "./WatchlistCalculator.jsx";
import { AverageCostCalculator } from "./AverageCostCalculator.jsx";

export const TickerCard = memo(function TickerCard({ symbol, entry, onRemove, onRefresh, onTimeframeChange }) {
  const [open, setOpen] = useState(true);
  const { quote, series, fundamentals, profile, loading, error, timeframe = "1week" } = entry || {};

  const tfObj = TIMEFRAMES.find((t) => t.id === timeframe) || TIMEFRAMES[1];

  const analysis = useMemo(() => {
    if (!series || series.length < 20) return null;
    const price = quote?.close ? +quote.close : series[series.length - 1].close;
    return { cls: classifyCached(series), sr: getSupportResistance(series, price), price };
  }, [series, quote]);

  const change = quote ? +quote.percent_change : null;
  const isUp = change != null && change >= 0;
  const updatedAgo = entry?.cachedAt ? formatRelativeTime(entry.cachedAt) : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 min-w-0">
          {open ? <ChevronDown size={16} className="text-zinc-500 shrink-0" /> : <ChevronRight size={16} className="text-zinc-500 shrink-0" />}
          <StockLogo symbol={symbol} logoUrl={profile?.logo} size={28} />
          <div className="flex flex-col text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-zinc-100 text-base leading-tight">{symbol}</span>
              <span className="text-[10px] bg-blue-500/10 border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded font-mono shrink-0">
                {tfObj.label} ({tfObj.name})
              </span>
            </div>
            <span className="text-zinc-400 text-xs truncate max-w-[180px] sm:max-w-[320px] font-sans">
              {getStockName(symbol, profile?.name)}
            </span>
          </div>
        </button>

        <div className="flex items-center bg-zinc-950 p-1 rounded border border-zinc-800 gap-1 text-[11px] font-mono">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => onTimeframeChange(symbol, tf.id)}
              disabled={loading}
              className={`px-2 py-0.5 rounded transition ${
                timeframe === tf.id
                  ? "bg-blue-600 text-white font-bold"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {quote && (
            <div className="text-right font-mono">
              <div className="text-zinc-100 text-base leading-tight">${fmtPrice(+quote.close)}</div>
              <div className={`text-xs leading-tight ${isUp ? "text-emerald-400" : "text-red-400"}`}>{fmtPct(change)}</div>
              {updatedAgo && (
                <div className="text-[9px] text-zinc-500 leading-tight mt-0.5" title="เวลาที่ดึงข้อมูลราคาล่าสุด">
                  อัปเดต {updatedAgo}
                </div>
              )}
            </div>
          )}
          <button onClick={() => onRefresh(symbol)} disabled={loading} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 disabled:opacity-40">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => onRemove(symbol)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-3">
          {error && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded px-3 py-2 mb-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
          {loading && !series && <div className="text-zinc-500 text-sm py-8 text-center">กำลังโหลดข้อมูลกราฟ Timeframe {tfObj.name} จาก Twelve Data…</div>}
          {!loading && !error && !analysis && series && series.length > 0 && (
            // หุ้นที่เพิ่งเข้าตลาดไม่นาน (เช่น IPO ใหม่) จะมีแท่งราคาไม่ครบ 20 แท่งที่ Timeframe นี้
            // ราคาล่าสุด/% เปลี่ยนแปลงด้านบนยังแสดงได้ปกติ (มาจากแท่งล่าสุด) เพียงแต่ยังคำนวณ
            // แนวรับ/แนวต้าน/EMA/RSI/MACD ไม่ได้จนกว่าจะมีข้อมูลย้อนหลังมากพอ
            <div className="text-zinc-500 text-sm py-8 text-center">
              หุ้นนี้มีข้อมูลย้อนหลังที่ Timeframe {tfObj.name} แค่ {series.length} แท่ง (ต้องการอย่างน้อย {MIN_BARS_FOR_FULL_INDICATORS} แท่งขึ้นไป) —
              อาจเป็นเพราะเพิ่งเข้าตลาดไม่นาน จึงยังคำนวณกราฟ/แนวรับ-แนวต้าน/EMA/RSI/MACD ไม่ได้ ราคาล่าสุดด้านบนยังถูกต้องตามปกติ
            </div>
          )}
          {!loading && !error && !analysis && (!series || series.length === 0) && (
            <div className="text-zinc-500 text-sm py-8 text-center">
              ยังไม่มีข้อมูลกราฟสำหรับ Timeframe {tfObj.name} — กดปุ่ม <RefreshCw size={12} className="inline -mt-0.5" /> เพื่อโหลดใหม่
            </div>
          )}

          {analysis && (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`text-xs font-medium px-2 py-1 rounded border ${TREND_STYLE[analysis.cls.trend]}`}>
                  เทรนด์: {TREND_TH[analysis.cls.trend]} ({tfObj.label})
                </span>
                <span className={`text-xs font-medium px-2 py-1 rounded border ${MOM_STYLE[analysis.cls.momentum]}`}>
                  โมเมนตัม: {MOM_TH[analysis.cls.momentum]}
                </span>
                {profile?.marketCapitalization && (
                  <span className="text-xs font-mono px-2 py-1 rounded border border-zinc-700 text-zinc-400">
                    Mkt Cap ${fmtBig(profile.marketCapitalization * 1e6)} (Finnhub)
                  </span>
                )}
              </div>

              <PriceChart series={series} support={analysis.sr.support} resistance={analysis.sr.resistance} timeframe={timeframe} />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 font-mono text-xs">
                <div className="bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800">
                  <div className="text-zinc-500">RSI(14) {tfObj.label}</div>
                  <div className={analysis.cls.rsi > 60 ? "text-emerald-400" : analysis.cls.rsi < 40 ? "text-red-400" : "text-zinc-200"}>
                    {analysis.cls.rsi != null ? analysis.cls.rsi.toFixed(1) : "—"}
                  </div>
                </div>
                <div className="bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800">
                  <div className="text-zinc-500">MACD Hist {tfObj.label}</div>
                  <div className={analysis.cls.macdHist > 0 ? "text-emerald-400" : "text-red-400"}>
                    {analysis.cls.macdHist != null ? analysis.cls.macdHist.toFixed(2) : "—"}
                  </div>
                </div>
                <div className="bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800">
                  <div className="text-zinc-500">EMA 20 / 50 / 200 {tfObj.label}</div>
                  <div className="text-zinc-200">
                    {fmtPrice(analysis.cls.e20)} / {fmtPrice(analysis.cls.e50)} / <span className="text-purple-400">{fmtPrice(analysis.cls.e200)}</span>
                  </div>
                </div>
                <div className="bg-zinc-950 rounded px-2 py-1.5 border border-zinc-800">
                  <div className="text-zinc-500">Volume</div>
                  <div className="text-zinc-200">{quote ? fmtBig(+quote.volume) : "—"}</div>
                </div>
              </div>

              <WatchlistCalculator currentPrice={analysis.price} support={analysis.sr.support} resistance={analysis.sr.resistance} />

              <AverageCostCalculator symbol={symbol} currentPrice={analysis.price} />

              <div className="text-xs text-zinc-500 mt-2">
                แนวรับหลัก (S1–S3): {analysis.sr.support.length ? analysis.sr.support.map((s) => `${s.price.toFixed(2)} (${s.touches}x)`).join(" · ") : "ยังไม่พบ"} &nbsp;|&nbsp;
                แนวต้านหลัก (R1–R3): {analysis.sr.resistance.length ? analysis.sr.resistance.map((r) => `${r.price.toFixed(2)} (${r.touches}x)`).join(" · ") : "ยังไม่พบ"}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

/* ============================================================
   SECTOR ROTATION VIEW
   ============================================================ */
