import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "./icons.jsx";
import { fmtPct, fmtPrice } from "../utils/formatters.js";

export function WatchlistCalculator({ currentPrice, support = [], resistance = [] }) {
  const [showCalc, setShowCalc] = useState(false);
  const [capital, setCapital] = useState(1000);
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");

  useEffect(() => {
    const s1 = support.length > 0 ? support[0].price : currentPrice;
    const s2 = support.length > 1 ? support[1].price : (s1 ? s1 * 0.95 : 0);

    if (s1) setEntryPrice(s1.toFixed(2));
    if (s2) setStopLoss(s2.toFixed(2));
  }, [support, currentPrice]);

  const cap = parseFloat(capital) || 0;
  const entry = parseFloat(entryPrice) || 0;
  const sl = parseFloat(stopLoss) || 0;

  const shares = entry > 0 ? cap / entry : 0;
  const maxLoss = entry > 0 && sl > 0 ? cap - (shares * sl) : 0;
  const riskAmount = entry - sl;

  const targets = useMemo(() => {
    const base = entry > 0 ? entry : currentPrice;
    return [0, 1, 2].map((i) => {
      const r = resistance[i];
      const price = r ? r.price : (base ? base * (1 + 0.1 * (i + 1)) : 0);
      const totalVal = shares * price;
      const profit = totalVal - cap;
      const profitPct = entry > 0 ? ((price - entry) / entry) * 100 : 0;
      const rewardAmount = price - entry;
      const rr = riskAmount > 0 && rewardAmount > 0 ? (rewardAmount / riskAmount).toFixed(2) : null;
      return {
        key: `R${i + 1}`,
        price,
        touches: r ? r.touches : null,
        isEstimate: !r,
        totalVal,
        profit,
        profitPct,
        rr,
      };
    });
  }, [resistance, entry, currentPrice, shares, cap, riskAmount]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setShowCalc((v) => !v)}
        className="w-full flex items-center justify-between bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60 rounded-lg px-3 py-2 transition-colors"
      >
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <span>🧮</span> เครื่องมือคำนวณกำไร & Risk/Reward (Position Sizing)
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          {showCalc ? "ซ่อนเครื่องมือ" : "คลิกเพื่อเปิดเครื่องมือ"}
          {showCalc ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {showCalc && (
        <div className="mt-2 bg-zinc-950/80 border border-zinc-800 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono text-right mb-2.5">Auto Technical Support/Resistance</div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">เงินทุนที่ลง ($)</label>
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100"
                placeholder="1000"
              />
            </div>

            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">จุดซื้อ / แนวรับ ($)</label>
              <input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-emerald-400 font-bold"
                placeholder="0.00"
              />
              <div className="flex gap-1 mt-1 flex-wrap">
                {support.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setEntryPrice(s.price.toFixed(2))}
                    className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-1 py-0.5 rounded hover:bg-emerald-500/20"
                  >
                    S{idx+1}: {s.price.toFixed(1)}
                  </button>
                ))}
                {currentPrice && (
                  <button
                    type="button"
                    onClick={() => setEntryPrice(currentPrice.toFixed(2))}
                    className="text-[9px] bg-zinc-800 text-zinc-300 border border-zinc-700 px-1 py-0.5 rounded hover:bg-zinc-700"
                  >
                    ปัจจุบัน
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">ตัดขาดทุน Stop Loss ($)</label>
              <input
                type="number"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-red-400"
                placeholder="0.00"
              />
            </div>
          </div>

          {cap > 0 && entry > 0 ? (
            <>
              <div className="text-[10px] text-zinc-500 mb-1.5">
                กำไรคาดการณ์อัตโนมัติ 3 ช่วง ตามแนวต้าน — เงินทุน ${fmtPrice(cap)} → {shares.toFixed(2)} หุ้น @ ${fmtPrice(entry)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {targets.map((t) => (
                  <div key={t.key} className="bg-zinc-900/90 border border-zinc-800/80 rounded p-2.5 font-mono text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-blue-400">
                        เป้าหมาย {t.key} {t.isEstimate ? "(ประมาณการ)" : `(${t.touches}x)`}
                      </span>
                      <span className="text-zinc-200 font-bold">${fmtPrice(t.price)}</span>
                    </div>
                    <div className={`font-bold ${t.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.profit >= 0 ? "+" : ""}${fmtPrice(t.profit)} ({fmtPct(t.profitPct)})
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-1">
                      R:R {t.rr ? `1 : ${t.rr}` : "—"}
                    </div>
                  </div>
                ))}
              </div>
              {maxLoss > 0 && (
                <div className="text-[10px] text-red-400 mt-2">
                  ⚠️ หากชน Stop Loss (${fmtPrice(sl)}) จะขาดทุนประมาณ ${fmtPrice(maxLoss)}
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-zinc-500 text-center py-3">
              กรอก "เงินทุนที่ลง" และ "จุดซื้อ" เพื่อคำนวณกำไรคาดการณ์อัตโนมัติ 3 ช่วงตามแนวต้าน
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   AVERAGE COST CALCULATOR (คำนวณค่าเฉลี่ยต้นทุนล่วงหน้า / DCA)
   ============================================================
   คำนวณต้นทุนเฉลี่ยใหม่ ถ้าจะซื้อหุ้นตัวนี้เพิ่ม โดยอ้างอิงจำนวนหุ้น + ต้นทุนเฉลี่ยเดิม
   ที่มีอยู่จริงในพอร์ตปัจจุบัน (รวมทุกพอร์ตย่อยที่ถือ symbol นี้อยู่) และรองรับการแบ่งซื้อ
   เป็นหลายไม้ (ไม้ละจำนวนเงิน + ราคาต่างกันได้ เช่น จะทยอยซื้อไล่ราคาลงมา) */
