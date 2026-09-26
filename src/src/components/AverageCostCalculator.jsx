import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "./icons.jsx";
import { fmtPct, fmtPrice } from "../utils/formatters.js";
import { loadStore } from "../api/quotaEngine.js";

export function AverageCostCalculator({ symbol, currentPrice }) {
  const [showCalc, setShowCalc] = useState(false);
  const [holding, setHolding] = useState({ shares: 0, avgCost: 0 });
  const lotIdRef = useRef(1);
  const [lots, setLots] = useState([{ id: 0, amount: "100", price: "" }]);

  // โหลดยอดถือครองปัจจุบันของ symbol นี้จากทุกพอร์ต ทุกครั้งที่เปิดเครื่องมือ
  // (เผื่อผู้ใช้เพิ่ง ซื้อ/แก้ไข พอร์ตในแท็บ "พอร์ตลงทุน" มาก่อนหน้านี้)
  useEffect(() => {
    if (!showCalc) return;
    (async () => {
      const ports = await loadStore("us-dash-portfolios-v3", []);
      let totalShares = 0;
      let totalCost = 0;
      (Array.isArray(ports) ? ports : []).forEach((p) => {
        (p.items || []).forEach((item) => {
          if (item.symbol === symbol) {
            const sh = Number(item.shares) || 0;
            totalShares += sh;
            totalCost += sh * (Number(item.avgCost) || 0);
          }
        });
      });
      setHolding({ shares: totalShares, avgCost: totalShares > 0 ? totalCost / totalShares : 0 });
    })();
  }, [showCalc, symbol]);

  // เติมราคาไม้แรกด้วยราคาปัจจุบันอัตโนมัติตอนเปิดเครื่องมือ (ถ้ายังไม่ได้กรอก)
  useEffect(() => {
    if (showCalc && currentPrice) {
      setLots((prev) =>
        prev.map((l, i) => (i === 0 && !l.price ? { ...l, price: currentPrice.toFixed(2) } : l))
      );
    }
  }, [showCalc, currentPrice]);

  const addLot = () => {
    lotIdRef.current += 1;
    setLots((prev) => [...prev, { id: lotIdRef.current, amount: "100", price: currentPrice ? currentPrice.toFixed(2) : "" }]);
  };
  const removeLot = (id) => {
    setLots((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  };
  const updateLot = (id, patch) => {
    setLots((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const computedLots = useMemo(() => {
    return lots.map((l) => {
      const amt = parseFloat(l.amount) || 0;
      const price = parseFloat(l.price) || 0;
      return { ...l, amt, price, sh: price > 0 ? amt / price : 0 };
    });
  }, [lots]);

  const totalNewAmount = computedLots.reduce((s, l) => s + l.amt, 0);
  const totalNewShares = computedLots.reduce((s, l) => s + l.sh, 0);

  const oldShares = holding.shares;
  const oldAvgCost = holding.avgCost;
  const hasHolding = oldShares > 0;

  const combinedShares = oldShares + totalNewShares;
  const combinedCost = oldShares * oldAvgCost + totalNewAmount;
  const newAvgCost = combinedShares > 0 ? combinedCost / combinedShares : 0;
  const avgChangePct = hasHolding && oldAvgCost > 0 ? ((newAvgCost - oldAvgCost) / oldAvgCost) * 100 : null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setShowCalc((v) => !v)}
        className="w-full flex items-center justify-between bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60 rounded-lg px-3 py-2 transition-colors"
      >
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <span>➗</span> เครื่องมือคำนวณค่าเฉลี่ยต้นทุนล่วงหน้า (DCA)
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          {showCalc ? "ซ่อนเครื่องมือ" : "คลิกเพื่อเปิดเครื่องมือ"}
          {showCalc ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {showCalc && (
        <div className="mt-2 bg-zinc-950/80 border border-zinc-800 rounded-lg p-3">
          <div className="text-[11px] text-zinc-400 mb-3">
            ถืออยู่ในพอร์ตปัจจุบัน (รวมทุกพอร์ต):{" "}
            {hasHolding ? (
              <span className="text-zinc-200 font-mono">
                {oldShares.toFixed(4)} หุ้น @ ${fmtPrice(oldAvgCost)} (ต้นทุนรวม ${fmtPrice(oldShares * oldAvgCost)})
              </span>
            ) : (
              <span className="text-zinc-500">ยังไม่มีหุ้น {symbol} ในพอร์ต — จะคำนวณต้นทุนเฉลี่ยจากไม้ที่กรอกด้านล่างเท่านั้น</span>
            )}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[2.5rem_1fr_1fr_5rem_1.5rem] items-center gap-2 text-[10px] text-zinc-500 px-0.5">
              <span>ไม้</span>
              <span>เงินลงทุน ($)</span>
              <span>ราคาซื้อ ($)</span>
              <span className="text-right">ได้หุ้น</span>
              <span></span>
            </div>
            {computedLots.map((l, idx) => (
              <div key={l.id} className="grid grid-cols-[2.5rem_1fr_1fr_5rem_1.5rem] items-center gap-2">
                <span className="text-[11px] text-zinc-500 font-mono">#{idx + 1}</span>
                <input
                  type="number"
                  value={l.amount}
                  onChange={(e) => updateLot(l.id, { amount: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-zinc-100"
                  placeholder="100"
                />
                <input
                  type="number"
                  value={l.price}
                  onChange={(e) => updateLot(l.id, { price: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs font-mono text-blue-300"
                  placeholder="0.00"
                />
                <span className="text-[11px] text-zinc-400 font-mono text-right">{l.sh > 0 ? l.sh.toFixed(4) : "—"}</span>
                <button
                  type="button"
                  onClick={() => removeLot(l.id)}
                  disabled={lots.length <= 1}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 disabled:opacity-30 justify-self-center"
                  title="ลบไม้นี้"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLot}
            className="mt-2.5 text-[11px] text-blue-300 hover:text-blue-200 border border-blue-500/30 hover:border-blue-500/50 bg-blue-500/10 px-2.5 py-1 rounded-md transition-colors"
          >
            + เพิ่มไม้ซื้อ
          </button>

          <div className="mt-3 pt-3 border-t border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
            <div className="bg-zinc-900/90 border border-zinc-800/80 rounded p-2.5">
              <div className="text-[10px] text-zinc-500">เงินลงทุนเพิ่มรวม</div>
              <div className="text-zinc-100 font-bold">${fmtPrice(totalNewAmount)}</div>
            </div>
            <div className="bg-zinc-900/90 border border-zinc-800/80 rounded p-2.5">
              <div className="text-[10px] text-zinc-500">หุ้นที่ได้เพิ่ม</div>
              <div className="text-zinc-100 font-bold">{totalNewShares.toFixed(4)}</div>
            </div>
            <div className="bg-zinc-900/90 border border-zinc-800/80 rounded p-2.5">
              <div className="text-[10px] text-zinc-500">หุ้นรวมหลังซื้อ</div>
              <div className="text-zinc-100 font-bold">{combinedShares > 0 ? combinedShares.toFixed(4) : "—"}</div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2.5">
              <div className="text-[10px] text-blue-300">ต้นทุนเฉลี่ยใหม่</div>
              <div className="text-blue-300 font-bold text-sm">${fmtPrice(newAvgCost)}</div>
              {avgChangePct != null && (
                <div className={`text-[10px] ${avgChangePct <= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                  {fmtPct(avgChangePct)} จากต้นทุนเดิม
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TICKER CARD
   ============================================================ */
