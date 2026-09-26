import { StockLogo } from "./StockLogo.jsx";
import { fmtPct, fmtPrice, getStockName } from "../utils/formatters.js";
import { CAP_TIER_STYLE, CAP_TIER_TH } from "../api/recommendationScan.js";
import { Plus } from "./icons.jsx";

export function RecommendedStockCard({ rec, idx, alreadyAdded, onAdd }) {
  const isUp = rec.quote ? +rec.quote.percent_change >= 0 : true;
  return (
    <div
      className="group relative w-[248px] sm:w-[264px] shrink-0 snap-start bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 rounded-xl p-3.5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-amber-500/10"
    >
      <div className="absolute -top-2.5 -left-2.5 w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-zinc-950 text-[11px] font-extrabold flex items-center justify-center shadow-md shadow-amber-500/30 ring-2 ring-zinc-950">
        {idx + 1}
      </div>
      <div>
        <div className="flex items-start justify-between gap-1.5 mb-2.5 pl-1">
          <div className="flex items-center gap-2">
            <StockLogo symbol={rec.symbol} logoUrl={rec.profile?.logo} size={30} />
            <div>
              <div className="flex items-center gap-1.5">
                <span title={rec.countryMeta?.name}>{rec.countryMeta?.flag}</span>
                <span className="font-mono font-bold text-sm text-zinc-100">{rec.symbol}</span>
              </div>
              <div className="text-[10px] text-zinc-400 truncate max-w-[130px]">
                {getStockName(rec.symbol, rec.profile?.name)}
              </div>
            </div>
          </div>
        </div>

        {rec.quote && (
          <div className="font-mono mb-2.5 flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-zinc-100">${fmtPrice(+rec.quote.close)}</span>
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${isUp ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
              {isUp ? "▲" : "▼"} {fmtPct(+rec.quote.percent_change)}
            </span>
          </div>
        )}

        <div className="mb-2 flex flex-wrap gap-1">
          {rec.growthRate != null && (
            <span
              title="อัตราเติบโตของรายได้หรือกำไร (สูงสุดที่มีข้อมูลจริง) — เกณฑ์บังคับข้อ 1 Disruptive Growth"
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
            >
              📈 โต {fmtPct(rec.growthRate)}
            </span>
          )}
          {rec.valuation?.ratio != null && (
            <span
              title={`${rec.valuation.method} = ราคาที่จ่ายต่อการเติบโต 1% — เกณฑ์บังคับข้อ 2 Margin of Safety`}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-sky-300 bg-sky-500/10 border-sky-500/30"
            >
              {rec.valuation.method} {rec.valuation.ratio.toFixed(2)}x
            </span>
          )}
          {rec.impliedCAGR != null && (
            <span
              title={`ผลตอบแทนทบต้นโดยประมาณต่อปี (เป้าหมายเชิงตัวเลข) — เกณฑ์บังคับข้อ 3 Risk-Reward`}
              className="text-[9px] font-bold px-1.5 py-0.5 rounded border text-amber-300 bg-amber-500/10 border-amber-500/30"
            >
              🎯 {fmtPct(rec.impliedCAGR)}/ปี
            </span>
          )}
          {rec.capTier && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${CAP_TIER_STYLE[rec.capTier]}`}>
              {CAP_TIER_TH[rec.capTier]}
            </span>
          )}
        </div>
        <div className="text-[9px] text-zinc-500 mb-2.5">
          {rec.countryMeta?.name} ({rec.region})
          {rec.sector && <> • {rec.sector}</>}
          {rec.mktCapB > 0 && <> • Mkt Cap ${rec.mktCapB.toFixed(1)}B</>}
        </div>

        <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-2.5 text-[10px] text-zinc-300 min-h-[54px] space-y-1">
          <div className="text-amber-400 font-bold mb-0.5 flex items-center gap-1">🚀 Hypergrowth VI</div>
          <div className="line-clamp-2">
            {rec.valuation?.marginOfSafetyPct != null
              ? `Margin of Safety ~${fmtPct(rec.valuation.marginOfSafetyPct)} เทียบมูลค่ายุติธรรม (${rec.valuation.method})`
              : "ผ่านเกณฑ์ Disruptive Growth + Margin of Safety + เป้าหมายผลตอบแทนครบทั้ง 3 ข้อ"}
          </div>
        </div>
      </div>

      <div className="pt-2.5 mt-2.5 border-t border-zinc-800">
        <button
          onClick={() => onAdd(rec.symbol)}
          disabled={alreadyAdded}
          className="w-full py-1.5 bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed text-blue-400 border border-blue-500/30 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition"
        >
          {alreadyAdded ? "อยู่ใน Watchlist แล้ว" : (<><Plus size={12} /> เพิ่มเข้า Watchlist</>)}
        </button>
      </div>
    </div>
  );
}

