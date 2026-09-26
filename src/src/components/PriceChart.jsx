import { useMemo } from "react";
import { useRecharts } from "../hooks/useRecharts.js";
import { TIMEFRAMES } from "../data/appConfig.js";
import { ema, macd, rsi } from "../utils/indicators.js";
import { CHART_VISIBLE_BARS } from "./WeeklyRecommendedPanel.jsx";
import { ChartLoadingPlaceholder } from "./ChartLoadingPlaceholder.jsx";
import { fmtBig } from "../utils/formatters.js";

export function PriceChart({ series, support, resistance, timeframe = "1week" }) {
  const RC = useRecharts();
  const tfObj = TIMEFRAMES.find((t) => t.id === timeframe) || TIMEFRAMES[1];

  const data = useMemo(() => {
    const closes = series.map((b) => b.close);
    const e20Arr = ema(closes, 20);
    const e50Arr = ema(closes, 50);
    const e200Arr = ema(closes, 200);
    const rsiArr = rsi(closes, 14);
    const { line: macdLine, signal: macdSignal, hist: macdHist } = macd(closes);

    const start = Math.max(0, series.length - CHART_VISIBLE_BARS);
    return series.slice(start).map((b, idx) => {
      const originalIdx = start + idx;
      const prevClose = originalIdx > 0 ? series[originalIdx - 1].close : b.close;
      return {
        date: b.date.slice(0, 16),
        close: b.close,
        ema20: e20Arr[originalIdx],
        ema50: e50Arr[originalIdx],
        ema200: e200Arr[originalIdx],
        volume: b.volume,
        volUp: b.close >= prevClose,
        rsi: rsiArr[originalIdx],
        macdLine: macdLine[originalIdx],
        macdSignal: macdSignal[originalIdx],
        macdHist: macdHist[originalIdx],
      };
    });
  }, [series]);

  const levels = [
    ...support.map((s) => s.price),
    ...resistance.map((r) => r.price),
    ...data.map((d) => d.close),
    ...data.map((d) => d.ema20).filter(Boolean),
    ...data.map((d) => d.ema50).filter(Boolean),
    ...data.map((d) => d.ema200).filter(Boolean),
  ];
  const min = Math.min(...levels) * 0.985;
  const max = Math.max(...levels) * 1.015;
  const maxVolume = Math.max(1, ...data.map((d) => d.volume || 0));

  if (!RC) return <ChartLoadingPlaceholder height={452} />;
  const {
    ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine, Bar, Cell, Legend,
  } = RC;

  return (
    <div className="space-y-1.5">
      {/* ราคา + แนวรับ/แนวต้าน + EMA 20/50/200 */}
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart data={data} margin={{ top: 6, right: 52, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1f33" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#7d7fa1", fontSize: 10 }} axisLine={{ stroke: "#31324a" }} tickLine={false} minTickGap={28} />
          <YAxis domain={[min, max]} tick={{ fill: "#7d7fa1", fontSize: 10 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => v.toFixed(0)} />
          <Tooltip
            contentStyle={{ background: "#141526", border: "1px solid #31324a", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
            labelStyle={{ color: "#a6a8c4" }}
            formatter={(v, name) => [
              `$${v != null ? (+v).toFixed(2) : "—"}`,
              name === "close" ? `ราคาปิด (${tfObj.label})` : name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v) => <span style={{ color: "#a6a8c4" }}>{v}</span>} />
          {resistance.map((r, i) => (
            <ReferenceLine key={`r${i}`} y={r.price} stroke="#f87171" strokeDasharray="4 3" strokeOpacity={0.9 - i * 0.2}
              label={{ value: `R${i + 1} ${r.price.toFixed(2)} (${r.touches}x)`, position: "right", fill: "#f87171", fontSize: 10 }} />
          ))}
          {support.map((s, i) => (
            <ReferenceLine key={`s${i}`} y={s.price} stroke="#34d399" strokeDasharray="4 3" strokeOpacity={0.9 - i * 0.2}
              label={{ value: `S${i + 1} ${s.price.toFixed(2)} (${s.touches}x)`, position: "right", fill: "#34d399", fontSize: 10 }} />
          ))}
          <Line type="monotone" dataKey="close" stroke="#8087f8" strokeWidth={1.75} dot={false} isAnimationActive={false} name="ราคาปิด" />
          <Line type="monotone" dataKey="ema20" stroke="#facc15" strokeWidth={1.25} dot={false} isAnimationActive={false} name="EMA20" connectNulls />
          <Line type="monotone" dataKey="ema50" stroke="#38bdf8" strokeWidth={1.25} dot={false} isAnimationActive={false} name="EMA50" connectNulls />
          <Line type="monotone" dataKey="ema200" stroke="#c084fc" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} name="EMA200" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume */}
      <ResponsiveContainer width="100%" height={64}>
        <ComposedChart data={data} margin={{ top: 0, right: 52, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis domain={[0, maxVolume * 1.1]} tick={{ fill: "#7d7fa1", fontSize: 9 }} axisLine={false} tickLine={false} width={46} tickFormatter={fmtBig} />
          <Tooltip
            contentStyle={{ background: "#141526", border: "1px solid #31324a", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#a6a8c4" }}
            formatter={(v) => [fmtBig(v), "Volume"]}
          />
          <Bar dataKey="volume" name="Volume" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.volUp ? "#34d39980" : "#f8717180"} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>

      {/* RSI(14) */}
      <ResponsiveContainer width="100%" height={70}>
        <ComposedChart data={data} margin={{ top: 4, right: 52, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: "#7d7fa1", fontSize: 9 }} axisLine={false} tickLine={false} width={46} />
          <Tooltip
            contentStyle={{ background: "#141526", border: "1px solid #31324a", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#a6a8c4" }}
            formatter={(v) => [v != null ? (+v).toFixed(1) : "—", "RSI(14)"]}
          />
          <ReferenceLine y={70} stroke="#f87171" strokeDasharray="3 3" strokeOpacity={0.6} />
          <ReferenceLine y={30} stroke="#34d399" strokeDasharray="3 3" strokeOpacity={0.6} />
          <Line type="monotone" dataKey="rsi" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} name="RSI(14)" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      {/* MACD(12,26,9) */}
      <ResponsiveContainer width="100%" height={80}>
        <ComposedChart data={data} margin={{ top: 4, right: 52, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fill: "#7d7fa1", fontSize: 9 }} axisLine={{ stroke: "#31324a" }} tickLine={false} minTickGap={28} />
          <YAxis tick={{ fill: "#7d7fa1", fontSize: 9 }} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => v.toFixed(1)} />
          <Tooltip
            contentStyle={{ background: "#141526", border: "1px solid #31324a", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "#a6a8c4" }}
            formatter={(v, name) => [v != null ? (+v).toFixed(3) : "—", name]}
          />
          <ReferenceLine y={0} stroke="#454764" />
          <Bar dataKey="macdHist" name="Histogram" isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={(d.macdHist || 0) >= 0 ? "#34d399" : "#f87171"} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="macdLine" stroke="#8087f8" strokeWidth={1.25} dot={false} isAnimationActive={false} name="MACD" connectNulls />
          <Line type="monotone" dataKey="macdSignal" stroke="#fbbf24" strokeWidth={1.25} dot={false} isAnimationActive={false} name="Signal" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ============================================================
   MULTI-PORTFOLIO VIEW
   ============================================================ */
/* ============================================================
   PORTFOLIO GROWTH HISTORY — ประวัติการซื้อขายจริง (Transaction Ledger)
   ============================================================
   ทุกครั้งที่มีการซื้อ/ขายผ่านการอัปโหลดรูปทำรายการ (import) หรือลบโพซิชันทิ้ง จะถูก
   บันทึกเป็นรายการลง "us-dash-tx-ledger-v1" (วันที่ + symbol + ประเภท + จำนวนหุ้น + ราคา)
   เพื่อใช้คำนวณกราฟการเติบโตของมูลค่าพอร์ตย้อนหลังตามการซื้อขายจริง แยกตาม YTD/6M/1Y/All Time
   (ดูฟังก์ชัน confirmImportRows และ deletePosition ด้านล่างที่เรียกใช้ appendTxLedgerEntries) */
export const TX_LEDGER_KEY = "us-dash-tx-ledger-v1";
export const HIST_CACHE_PREFIX = "us-dash-hist-daily-v1-";

