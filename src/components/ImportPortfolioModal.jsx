import { AlertTriangle, CheckSquare, ImageIcon, Plus, RefreshCw, Trash2, Upload, X } from "./icons.jsx";
import { fmtPrice } from "../utils/formatters.js";

export function ImportPortfolioModal({
  activePort,
  portfolio,
  importPreview, importLoading, importError, importRows,
  importFileRef,
  handleImportFileChange,
  updateImportRow,
  removeImportRow,
  confirmImportRows,
  closeImportModal,
}) {
  return (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={closeImportModal}>
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-2xl w-full max-h-[85vh] overflow-y-auto p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <ImageIcon size={16} className="text-purple-400" />
                อัปโหลดรูปทำรายการ — ให้ AI อ่านข้อมูลอัตโนมัติ
              </div>
              <button onClick={closeImportModal} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
                <X size={16} />
              </button>
            </div>

            <div className="text-[11px] text-zinc-500">
              อัปโหลดภาพการทำรายการซื้อ/ขายหุ้น (เช่น สลิปยืนยันคำสั่งซื้อขาย ประวัติการทำรายการ หรือภาพรวมพอร์ตจากแอปโบรกเกอร์)
              ระบบจะส่งภาพไปให้ AI วิเคราะห์เองว่ามีการซื้อหรือขายอะไร เป็นหุ้นตัวใหม่หรือซื้อเพิ่ม/ตัดขายหุ้นที่มีอยู่แล้ว
              พร้อมจำนวนหุ้น ราคา และวันที่ — ตรวจสอบและแก้ไขข้อมูลให้ถูกต้องก่อนกดยืนยันเสมอ
            </div>

            {!importPreview && (
              <button
                onClick={() => importFileRef.current?.click()}
                className="w-full border-2 border-dashed border-zinc-700 hover:border-purple-500/60 rounded-lg py-8 flex flex-col items-center gap-2 text-zinc-500 hover:text-purple-400 transition text-xs"
              >
                <Upload size={22} />
                คลิกเพื่อเลือกรูปภาพการทำรายการ
              </button>
            )}

            {importPreview && (
              <div className="rounded-lg overflow-hidden border border-zinc-800 max-h-56">
                <img src={importPreview} alt="transaction screenshot" className="w-full h-full object-contain bg-zinc-950" />
              </div>
            )}

            {importPreview && (
              <button
                onClick={() => importFileRef.current?.click()}
                className="text-[11px] text-blue-400 hover:text-blue-300"
              >
                เปลี่ยนรูปภาพ
              </button>
            )}

            {importLoading && (
              <div className="flex items-center gap-2 text-xs text-purple-400 py-3">
                <RefreshCw size={14} className="animate-spin" /> กำลังให้ AI อ่านข้อมูลจากภาพ...
              </div>
            )}

            {importError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                <AlertTriangle size={14} /> {importError}
              </div>
            )}

            {!importLoading && importRows.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <CheckSquare size={13} className="text-emerald-400" />
                  ตรวจสอบและแก้ไขข้อมูลก่อนบันทึกเข้าพอร์ต "{activePort.name}"
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="pb-1.5 pr-2"></th>
                        <th className="pb-1.5 pr-2">ประเภท</th>
                        <th className="pb-1.5 pr-2">Symbol</th>
                        <th className="pb-1.5 pr-2 text-right">จำนวนหุ้น</th>
                        <th className="pb-1.5 pr-2 text-right">ราคา/หุ้น ($)</th>
                        <th className="pb-1.5 pr-2">วันที่ทำรายการ</th>
                        <th className="pb-1.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {importRows.map((row, idx) => {
                        const existsInPortfolio = portfolio.some((p) => p.symbol === row.symbol.toUpperCase().trim());
                        return (
                        <tr key={idx}>
                          <td className="py-1.5 pr-2">
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={(e) => updateImportRow(idx, { include: e.target.checked })}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => updateImportRow(idx, { action: "BUY" })}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${row.action === "BUY" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "bg-zinc-950 text-zinc-500 border-zinc-800"}`}
                              >
                                BUY
                              </button>
                              <button
                                type="button"
                                onClick={() => updateImportRow(idx, { action: "SELL" })}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${row.action === "SELL" ? "bg-amber-500/20 text-amber-300 border-amber-500/50" : "bg-zinc-950 text-zinc-500 border-zinc-800"}`}
                              >
                                SELL
                              </button>
                            </div>
                            <div className="text-[9px] text-zinc-600 mt-0.5">
                              {existsInPortfolio
                                ? (row.action === "SELL" ? "ตัดขายของเดิม" : "ซื้อเพิ่มของเดิม")
                                : (row.action === "SELL" ? "ไม่พบในพอร์ต" : "หุ้นตัวใหม่")}
                            </div>
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="text"
                              value={row.symbol}
                              onChange={(e) => updateImportRow(idx, { symbol: e.target.value.toUpperCase() })}
                              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-100 font-mono"
                            />
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={row.shares === null || row.shares === undefined ? "" : row.shares}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "" || /^\d*\.?\d*$/.test(v)) {
                                  updateImportRow(idx, { shares: v === "" ? null : v });
                                }
                              }}
                              onBlur={(e) => {
                                const n = parseFloat(e.target.value);
                                updateImportRow(idx, { shares: Number.isFinite(n) && n > 0 ? n : null });
                              }}
                              placeholder="กรอกจำนวนหุ้น"
                              className={`w-24 bg-zinc-950 border rounded px-1.5 py-1 text-right text-zinc-100 font-mono ${
                                row.shares === null || row.shares === undefined || row.shares === "" ? "border-amber-500/60" : "border-zinc-800"
                              }`}
                            />
                            {(row.shares === null || row.shares === undefined || row.shares === "") && (
                              <div className="text-[9px] text-amber-500 mt-0.5">ไม่พบในภาพ — กรอกเอง</div>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={row.price === null || row.price === undefined ? "" : row.price}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "" || /^\d*\.?\d*$/.test(v)) {
                                  updateImportRow(idx, { price: v === "" ? null : v });
                                }
                              }}
                              onBlur={(e) => {
                                const n = parseFloat(e.target.value);
                                updateImportRow(idx, { price: Number.isFinite(n) && n > 0 ? n : null });
                              }}
                              className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-right text-zinc-100 font-mono"
                              placeholder={row.price === null || row.price === undefined || row.price === "" ? "ไม่พบ — กรอกเอง" : ""}
                            />
                            {Number.isFinite(row.amount) && (
                              <div className="text-[9px] text-zinc-600 mt-0.5">ยอดรวม ${fmtPrice(row.amount)}</div>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="date"
                              value={row.date || ""}
                              onChange={(e) => updateImportRow(idx, { date: e.target.value })}
                              className={`w-32 bg-zinc-950 border rounded px-1.5 py-1 text-zinc-100 font-mono ${
                                row.date ? "border-zinc-800" : "border-amber-500/60"
                              }`}
                            />
                            {!row.date && (
                              <div className="text-[9px] text-amber-500 mt-0.5">
                                ไม่พบวันที่ในภาพ — ถ้าไม่กรอก จะถือว่าซื้อ "วันนี้" (กราฟเติบโตจะไม่มีประวัติย้อนหลังของหุ้นตัวนี้)
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 text-center">
                            <button
                              onClick={() => removeImportRow(idx)}
                              className="text-zinc-500 hover:text-red-400"
                              title="ลบรายการนี้ออกจากรายการนำเข้า"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-zinc-500">
                  AI จะพยายามระบุประเภทรายการ (ซื้อ/ขาย) ให้อัตโนมัติ — ตรวจสอบและแก้ไขได้ก่อนยืนยัน รายการ BUY ที่ Symbol ตรงกับหุ้นเดิมจะถูกคำนวณต้นทุนเฉลี่ยใหม่ให้อัตโนมัติ ส่วนรายการ SELL จะตัดจำนวนหุ้นออกจากของเดิม (หากขายหมดจะลบออกจากพอร์ต)
                  หากภาพไม่มีคอลัมน์จำนวนหุ้น (เช่น ตารางประวัติรายการที่มีแต่ยอดเงินรวม) ระบบจะขึ้นเตือนสีเหลืองให้กรอกจำนวนหุ้นเอง และจะคำนวณราคาต่อหุ้นจากยอดรวมให้อัตโนมัติเมื่อกรอกจำนวนหุ้นแล้ว
                  หากภาพเป็น "ภาพรวมพอร์ต" (snapshot ยอดถือครองปัจจุบัน) ที่ไม่มีวันที่ทำรายการต่อแถว ให้กรอกวันที่ซื้อจริง (หรือวันที่ประมาณ) ในคอลัมน์วันที่ด้วยตัวเอง — ไม่เช่นนั้นระบบจะถือว่าทุกรายการซื้อ "วันนี้" ทำให้กราฟการเติบโตของพอร์ตย้อนหลังแสดงเป็นเส้นแบนไม่มีขึ้นลง เพราะไม่มีประวัติให้คำนวณก่อนหน้านี้
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={closeImportModal}
                className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmImportRows}
                disabled={importRows.length === 0 || importLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium"
              >
                <Plus size={13} /> ยืนยันบันทึกรายการเข้าพอร์ต "{activePort.name}"
              </button>
            </div>
          </div>
        </div>
  );
}
