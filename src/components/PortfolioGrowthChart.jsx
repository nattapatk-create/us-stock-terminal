import { useEffect, useMemo, useRef, useState } from "react";
import { useRecharts } from "../hooks/useRecharts.js";
import { loadTxLedger, getDailyHistory } from "../api/transactionLedger.js";
import { ChartLoadingPlaceholder } from "./ChartLoadingPlaceholder.jsx";
import { fmtPct } from "../utils/formatters.js";
import { RefreshCw } from "./icons.jsx";

export function PortfolioGrowthChart({ portfolios, tdKey, dataMap, cashAmount, cashIncluded, fmtMoney }) {
  const RC = useRecharts();
  const [range, setRange] = useState("MAX");
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState("");

  // เก็บ dataMap ล่าสุดไว้ใน ref (ไม่ใส่เป็น dependency ของ effect ด้านล่าง) เพื่อให้สามารถ
  // "หยิบยืม" ราคารายวันที่แอปส่วนอื่นเพิ่งโหลดไว้แล้วมาใช้ได้ทันทีโดยไม่ยิง Twelve Data ซ้ำ
  // โดยไม่ทำให้ effect ดึงข้อมูลย้อนหลังต้องรันซ้ำทุกครั้งที่ dataMap อัปเดต (ซึ่งเกิดถี่มาก)
  const dataMapRef = useRef(dataMap);
  useEffect(() => {
    dataMapRef.current = dataMap;
  }, [dataMap]);

  // ยอดถือครองปัจจุบันรวมทุกพอร์ต แยกตาม symbol (ใช้เทียบกับ ledger เพื่อเติมประวัติย้อนหลัง
  // ของโพซิชันเก่าที่มีอยู่ก่อนเริ่มบันทึกประวัติการซื้อขาย)
  const currentHoldings = useMemo(() => {
    const map = {};
    (portfolios || []).forEach((p) => {
      (p.items || []).forEach((item) => {
        if (!item.symbol || !(item.shares > 0)) return;
        if (!map[item.symbol]) map[item.symbol] = { shares: 0, cost: 0, lastTxDate: null };
        map[item.symbol].shares += item.shares;
        map[item.symbol].cost += item.shares * (Number(item.avgCost) || 0);
        if (item.lastTxDate && (!map[item.symbol].lastTxDate || item.lastTxDate < map[item.symbol].lastTxDate)) {
          map[item.symbol].lastTxDate = item.lastTxDate;
        }
      });
    });
    return map;
  }, [portfolios]);

  // ผสาน ledger จริงเข้ากับยอดถือครองปัจจุบัน — ถ้ามีส่วนต่าง (โพซิชันเก่าก่อนมีระบบบันทึกประวัติ)
  // ให้เติมรายการ "ซื้อ" สังเคราะห์ ณ วันที่ทำรายการล่าสุดที่ทราบ (หรือวันนี้ถ้าไม่เคยรู้วันที่เลย)
  const effectiveLedger = useMemo(() => {
    const raw = loadTxLedger();
    const netShares = {};
    raw.forEach((e) => {
      const delta = e.type === "SELL" ? -e.shares : e.shares;
      netShares[e.symbol] = (netShares[e.symbol] || 0) + delta;
    });
    const todayStr = new Date().toISOString().slice(0, 10);
    const backfill = [];
    Object.keys(currentHoldings).forEach((sym) => {
      const holding = currentHoldings[sym];
      const known = netShares[sym] || 0;
      const diff = holding.shares - known;
      if (diff > 1e-6) {
        backfill.push({
          id: `backfill-${sym}`,
          symbol: sym,
          type: "BUY",
          shares: diff,
          price: holding.shares > 0 ? holding.cost / holding.shares : 0,
          date: holding.lastTxDate || todayStr,
          synthetic: true,
        });
      }
    });
    return [...raw, ...backfill].filter((e) => e.symbol && e.shares > 0 && e.date);
  }, [currentHoldings]);

  const symbols = useMemo(() => [...new Set(effectiveLedger.map((e) => e.symbol))].sort(), [effectiveLedger]);
  const earliestDate = useMemo(
    () => effectiveLedger.reduce((min, e) => (!min || e.date < min ? e.date : min), null),
    [effectiveLedger]
  );
  const symbolsKey = symbols.join(",");

  useEffect(() => {
    if (!tdKey || symbols.length === 0 || !earliestDate) {
      setSeries([]);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadedCount(0);
    setError("");

    const todayStr = new Date().toISOString().slice(0, 10);
    const daysSpan = Math.ceil((new Date(todayStr) - new Date(earliestDate)) / 86400000) + 10;
    const outputsize = Math.min(Math.max(daysSpan, 30), 5000);
    const sortedLedger = [...effectiveLedger].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // priceMaps เติมทีละสัญลักษณ์เมื่อโหลดเสร็จ แล้ว recompute() ทันที — ทำให้กราฟเริ่มขึ้นให้เห็น
    // ตั้งแต่หุ้นตัวแรกที่โหลดเสร็จ (ไม่ต้องรอให้ครบทุกตัวก่อนถึงจะเห็นอะไรเลย) ระยะเวลารวมยังเท่าเดิม
    // (จำกัดด้วยคิว Twelve Data เท่าเดิม ไม่กระทบโควตา) แต่ผู้ใช้เห็นความคืบหน้าได้เร็วขึ้นมาก
    const priceMaps = {};

    const recompute = () => {
      if (cancelled) return;
      const sortedDates = new Set([todayStr]);
      Object.values(priceMaps).forEach((m) => {
        m.forEach((_, d) => {
          if (d >= earliestDate && d <= todayStr) sortedDates.add(d);
        });
      });
      const dates = [...sortedDates].sort();

      const sharesHeld = {};
      const lastKnownPrice = {};
      const acquisitionPrice = {};
      symbols.forEach((s) => {
        sharesHeld[s] = 0;
        acquisitionPrice[s] = null;
      });

      let ledgerPtr = 0;
      const points = [];
      dates.forEach((d) => {
        while (ledgerPtr < sortedLedger.length && sortedLedger[ledgerPtr].date <= d) {
          const e = sortedLedger[ledgerPtr];
          const delta = e.type === "SELL" ? -e.shares : e.shares;
          sharesHeld[e.symbol] = (sharesHeld[e.symbol] || 0) + delta;
          if (e.type === "BUY") acquisitionPrice[e.symbol] = e.price;
          ledgerPtr++;
        }
        let dayValue = 0;
        symbols.forEach((s) => {
          const held = sharesHeld[s] || 0;
          if (held <= 1e-9) return;
          const m = priceMaps[s];
          const priceOnDay = m ? m.get(d) : null;
          if (priceOnDay != null) lastKnownPrice[s] = priceOnDay;
          const priceToUse = lastKnownPrice[s] != null ? lastKnownPrice[s] : acquisitionPrice[s] != null ? acquisitionPrice[s] : 0;
          dayValue += held * priceToUse;
        });
        points.push({ date: d, value: dayValue });
      });

      setSeries(points);
    };

    Promise.all(
      symbols.map(async (sym) => {
        try {
          // หยิบยืมราคารายวันที่แอปส่วนอื่นเพิ่งโหลดไว้แล้ว (เช่นเปิดดูกราฟตัวนี้ที่ Timeframe 1D
          // อยู่ในแท็บ Watchlist) มาใช้ตรง ๆ โดยไม่ยิง Twelve Data ซ้ำเลยสักครั้งสำหรับตัวนี้
          const cachedEntry = dataMapRef.current?.[sym];
          const existingDaily =
            cachedEntry?.timeframe === "1day" && Array.isArray(cachedEntry.series) && cachedEntry.series.length > 0
              ? cachedEntry.series
              : null;
          const bars = existingDaily
            ? existingDaily.map((b) => ({ date: String(b.date).slice(0, 10), close: b.close }))
            : await getDailyHistory(sym, tdKey, outputsize);

          if (cancelled) return;
          const m = new Map();
          bars.forEach((b) => m.set(b.date, b.close));
          priceMaps[sym] = m;
          recompute();
        } finally {
          if (!cancelled) setLoadedCount((c) => c + 1);
        }
      })
    )
      .catch((e) => {
        if (!cancelled) setError(e.message || "ดึงข้อมูลราคาย้อนหลังไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tdKey, symbolsKey, earliestDate]);

  const filteredSeries = useMemo(() => {
    if (series.length === 0) return [];
    const lastDate = new Date(series[series.length - 1].date);
    let fromStr = null;
    if (range === "1M") {
      const d = new Date(lastDate);
      d.setMonth(d.getMonth() - 1);
      fromStr = d.toISOString().slice(0, 10);
    } else if (range === "YTD") {
      fromStr = `${lastDate.getFullYear()}-01-01`;
    } else if (range === "1Y") {
      const d = new Date(lastDate);
      d.setFullYear(d.getFullYear() - 1);
      fromStr = d.toISOString().slice(0, 10);
    }
    if (!fromStr) return series;
    const clipped = series.filter((p) => p.date >= fromStr);
    return clipped.length > 0 ? clipped : series;
  }, [series, range]);

  const stats = useMemo(() => {
    if (filteredSeries.length === 0) return null;
    const startVal = filteredSeries[0].value;
    const endVal = filteredSeries[filteredSeries.length - 1].value;
    const changeVal = endVal - startVal;
    const changePct = startVal > 0 ? (changeVal / startVal) * 100 : 0;
    return { startVal, endVal, changeVal, changePct };
  }, [filteredSeries]);

  const rangeLabels = { "1M": "1 เดือน", YTD: "YTD", "1Y": "1 ปี", MAX: "Max" };
  const cashPart = cashIncluded ? cashAmount : 0;

  if (!RC) return <ChartLoadingPlaceholder height={320} />;
  const { ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } = RC;

  return (
    <div className="bg-zinc-900 border border-blue-500/20 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
            การเติบโตของมูลค่าพอร์ต (รวมทุกพอร์ต)
          </div>
          {stats && (
            <div className="flex items-baseline gap-2 mt-1 flex-wrap">
              <span className="text-xl font-mono font-bold text-zinc-100">{fmtMoney(stats.endVal + cashPart)}</span>
              <span className={`text-xs font-mono font-semibold ${stats.changeVal >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {stats.changeVal >= 0 ? "+" : ""}
                {fmtMoney(stats.changeVal)} ({fmtPct(stats.changePct)}) {rangeLabels[range]}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-full p-0.5">
          {["1M", "YTD", "1Y", "MAX"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition ${
                range === r ? "bg-blue-600 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {rangeLabels[r]}
            </button>
          ))}
        </div>
      </div>

      {!tdKey ? (
        <div className="text-[11px] text-amber-400 py-6 text-center">
          ใส่ Twelve Data API Key (เมนู ⚙ มุมขวาบน) เพื่อดึงราคาปิดย้อนหลังมาสร้างกราฟการเติบโตของพอร์ต
        </div>
      ) : symbols.length === 0 ? (
        <div className="text-[11px] text-zinc-500 py-6 text-center">
          ยังไม่มีประวัติการซื้อขายหุ้นในพอร์ต — เพิ่มหุ้นผ่านการอัปโหลดรูปทำรายการเพื่อเริ่มติดตามการเติบโตของมูลค่าพอร์ต
        </div>
      ) : loading && series.length === 0 ? (
        <div className="text-[11px] text-zinc-500 py-10 text-center flex items-center justify-center gap-2">
          <RefreshCw size={13} className="animate-spin" /> กำลังดึงราคาปิดย้อนหลัง ({loadedCount}/{symbols.length} สัญลักษณ์)...
        </div>
      ) : error && series.length === 0 ? (
        <div className="text-[11px] text-red-400 py-6 text-center">{error}</div>
      ) : filteredSeries.length > 0 ? (
        <>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={filteredSeries} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="portfolioGrowthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8087f8" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8087f8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1f33" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#7d7fa1" }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "short" })}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#7d7fa1" }}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => fmtMoney(v + cashPart)}
                  width={72}
                />
                <Tooltip
                  contentStyle={{ background: "#141526", border: "1px solid #31324a", borderRadius: 8, fontSize: 11 }}
                  labelFormatter={(d) => new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" })}
                  formatter={(val) => [fmtMoney(val + cashPart), "มูลค่าพอร์ต"]}
                />
                <Area type="monotone" dataKey="value" stroke="#8087f8" strokeWidth={2} fill="url(#portfolioGrowthFill)" dot={false} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-zinc-600">
            คำนวณจากประวัติการซื้อ/ขายจริงในพอร์ต เริ่มนับตั้งแต่{" "}
            {new Date(earliestDate).toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" })} x
            ราคาปิดรายวันจาก Twelve Data{cashIncluded ? " (รวมเงินสด — ถือเป็นค่าคงที่ ไม่มีประวัติย้อนหลัง)" : ""} — อาจต่างจากราคาเรียลไทม์
            เล็กน้อยเพราะใช้ราคาปิดของแต่ละวัน
            {loading && loadedCount < symbols.length && (
              <span className="text-blue-400"> · กำลังโหลดเพิ่ม ({loadedCount}/{symbols.length})...</span>
            )}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-zinc-500 py-6 text-center">ไม่มีข้อมูลเพียงพอสำหรับช่วงเวลาที่เลือก</div>
      )}
    </div>
  );
}

