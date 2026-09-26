import { memo } from "react";

/* ============================================================
   QUOTA METER — แถบแสดงการใช้โควตาสองฝั่งแบบเรียลไทม์
   ------------------------------------------------------------
   เดิมหัวแอปโชว์แค่ "จำนวนครั้งที่ใช้วันนี้" เป็นตัวเลขลอย ๆ ซึ่งไม่ช่วยให้รู้เลยว่าใกล้ชนเพดาน
   หรือยัง และภาระงานกระจายไปสองฝั่งสมดุลแค่ไหน แถบนี้แสดงครบในที่เดียว:
     • หลอดบน = โควตา "ต่อนาที" ที่ใช้ไปในหน้าต่าง 60 วินาทีล่าสุด (เห็นจังหวะยิงจริง)
     • หลอดล่าง = โควตา "ต่อวัน" ที่ใช้ไป (ตัวจำกัดที่แท้จริงของแผนฟรี Twelve Data)
     • เลขในวงเล็บ = จำนวนงานที่รอคิวอยู่ ณ ตอนนั้น (รู้ทันทีว่าฝั่งไหนกำลังเป็นคอขวด)
     • แถบสัดส่วนขวาสุด = สัดส่วนภาระงานวันนี้ระหว่าง TD กับ FH (เป้าหมายของการ balance)
   ============================================================ */
export const QuotaBar = ({ used, limit, color }) => {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : color;
  return (
    <div className="h-1 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div className={`h-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
};

export const QuotaMeter = memo(function QuotaMeter({ quota, tdCallsToday, fhCallsToday }) {
  const totalToday = tdCallsToday + fhCallsToday;
  const tdShare = totalToday > 0 ? Math.round((tdCallsToday / totalToday) * 100) : 0;
  const rows = [
    { key: "td", label: "TD", color: "bg-blue-400", text: "text-blue-300", stat: quota.td, today: tdCallsToday,
      hint: "Twelve Data — สงวนไว้สำหรับแท่งราคาย้อนหลัง (candles) ซึ่งเป็นงานที่มีแต่ฝั่งนี้ทำได้ นับเป็น credit ต่อสัญลักษณ์" },
    { key: "fh", label: "FH", color: "bg-emerald-400", text: "text-emerald-300", stat: quota.fh, today: fhCallsToday,
      hint: "Finnhub — รับภาระราคาล่าสุด/งบการเงิน/ข่าว/โลโก้ เพราะโควตาต่อนาทีสูงกว่าและไม่จำกัดรายวัน" },
  ];
  return (
    <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-400 border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 rounded-lg">
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2" title={r.hint}>
            <span className={`w-6 ${r.text} font-semibold`}>{r.label}</span>
            <div className="w-20">
              <QuotaBar used={r.stat.minuteUsed} limit={r.stat.minuteLimit} color={r.color} />
            </div>
            <span className="w-16 text-zinc-500">
              {r.stat.minuteUsed}/{r.stat.minuteLimit}<span className="text-zinc-700">/น.</span>
            </span>
            <div className="w-20">
              <QuotaBar used={r.today} limit={r.stat.dayLimit} color={r.color} />
            </div>
            <span className="w-20 text-zinc-500">
              {r.today}{r.stat.dayLimit ? `/${r.stat.dayLimit}` : ""}<span className="text-zinc-700">/วัน</span>
            </span>
            {r.stat.queued > 0 && (
              <span className="text-amber-400/80" title="จำนวนคำขอที่รอคิวอยู่ตอนนี้">คิว {r.stat.queued}</span>
            )}
          </div>
        ))}
      </div>
      <div className="pl-2 border-l border-zinc-800 text-center" title="สัดส่วนภาระงานวันนี้ระหว่างสองแหล่งข้อมูล — ยิ่งฝั่ง Finnhub มาก แปลว่าสงวน credit ของ Twelve Data ไว้ทำแท่งราคาได้มาก">
        <div className="flex h-1.5 w-16 rounded-full overflow-hidden bg-zinc-800">
          <div className="bg-blue-400" style={{ width: `${tdShare}%` }} />
          <div className="bg-emerald-400" style={{ width: `${100 - tdShare}%` }} />
        </div>
        <div className="text-[10px] text-zinc-500 mt-1">{tdShare}% / {100 - tdShare}%</div>
      </div>
    </div>
  );
});

/* ============================================================
   MAIN APP
   ============================================================ */
