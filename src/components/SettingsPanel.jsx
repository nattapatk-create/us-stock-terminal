export function SettingsPanel({
  tdKeyDraft, setTdKeyDraft,
  fhKeyDraft, setFhKeyDraft,
  geminiKeyDraft, setGeminiKeyDraft,
  tdRateDraft, setTdRateDraft,
  fhRateDraft, setFhRateDraft,
  tdDailyDraft, setTdDailyDraft,
  fhDailyDraft, setFhDailyDraft,
  onSave,
}) {
  return (
        <div className="p-4 bg-zinc-900 border-b border-zinc-800 space-y-3">
          <div className="text-xs font-semibold text-zinc-200">⚙️ การตั้งค่า API Key</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-zinc-400 block mb-1">Twelve Data API Key (หลัก สำหรับราคา & กราฟ)</label>
              <input
                type="password"
                value={tdKeyDraft}
                onChange={(e) => setTdKeyDraft(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="ใส่ Key Twelve Data"
              />
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Finnhub API Key (เสริม สำหรับงบการเงิน & โลโก้)</label>
              <input
                type="password"
                value={fhKeyDraft}
                onChange={(e) => setFhKeyDraft(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="ใส่ Key Finnhub"
              />
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">Google Gemini API Key (สำหรับอ่านรูปพอร์ตอัตโนมัติ)</label>
              <input
                type="password"
                value={geminiKeyDraft}
                onChange={(e) => setGeminiKeyDraft(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="AIza..."
              />
              <div className="text-[10px] text-zinc-500 mt-1">
                ใช้สำหรับปุ่ม "อัปโหลดรูปพอร์ต" ในหน้าพอร์ตลงทุน — ขอ Key ได้ที่ aistudio.google.com/apikey คีย์จะถูกเก็บในเบราว์เซอร์ของคุณเท่านั้น
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <div>
              <label className="text-zinc-400 block mb-1">
                Twelve Data: จำนวนคำขอสูงสุดต่อนาที (ตาม Plan ของคุณ)
              </label>
              <input
                type="number"
                min="1"
                value={tdRateDraft}
                onChange={(e) => setTdRateDraft(e.target.value)}
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="8"
              />
              <div className="text-[10px] text-zinc-500 mt-1">แผนฟรี = 8 • ปรับตาม Plan ที่คุณสมัคร</div>
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">
                Finnhub: จำนวนคำขอสูงสุดต่อนาที (ตาม Plan ของคุณ)
              </label>
              <input
                type="number"
                min="1"
                value={fhRateDraft}
                onChange={(e) => setFhRateDraft(e.target.value)}
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="60"
              />
              <div className="text-[10px] text-zinc-500 mt-1">แผนฟรี ≈ 60 • ปรับสูงขึ้นได้ถ้าใช้ Plan เสียเงิน เพื่อดึงงบการเงิน/ข่าว/ราคาล่าสุดเร็วขึ้นและลดภาระ Twelve Data ลงไปอีก</div>
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">
                Twelve Data: โควตา credit ต่อวัน
              </label>
              <input
                type="number"
                min="0"
                value={tdDailyDraft}
                onChange={(e) => setTdDailyDraft(e.target.value)}
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="800"
              />
              <div className="text-[10px] text-zinc-500 mt-1">แผนฟรี = 800 • ใส่ 0 = ไม่จำกัด • ระบบจะหยุดยิงเองเมื่อใกล้ชนเพดาน แล้วย้ายงานที่ทำได้ไปฝั่ง Finnhub แทน</div>
            </div>
            <div>
              <label className="text-zinc-400 block mb-1">
                Finnhub: โควตาคำขอต่อวัน
              </label>
              <input
                type="number"
                min="0"
                value={fhDailyDraft}
                onChange={(e) => setFhDailyDraft(e.target.value)}
                className="w-28 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="0"
              />
              <div className="text-[10px] text-zinc-500 mt-1">แผนฟรีไม่จำกัดรายวัน = ใส่ 0 • ใส่ตัวเลขถ้า Plan ของคุณมีเพดานรายวัน</div>
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 leading-relaxed border-t border-zinc-800 pt-2">
            ระบบจัดสรรโควตาจะยิงคำขอพร้อมกันได้จนเต็มเพดานต่อนาทีของแต่ละเจ้า (ไม่ใช่รอเว้นจังหวะทีละคำขอแบบเดิม
            ซึ่งเสียโควตาไปกับเวลารอเครือข่าย) รวมคำขอหลายสัญลักษณ์ให้เป็นคำขอเดียวโดยอัตโนมัติ และเลือกแหล่งข้อมูล
            ของ "ราคาล่าสุด" ตามโควตาที่เหลือจริงของทั้งสองฝั่ง ณ ขณะนั้น — ตัวเลขที่กรอกตรงนี้จึงมีผลโดยตรงกับ
            ความเร็วในการสแกน ยิ่งกรอกตรงกับ Plan จริงยิ่งใช้โควตาได้เต็มโดยไม่โดนปฏิเสธ
          </div>
          <button
            onClick={() => { commitKeys(); setShowSettings(false); }}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-medium"
          >
            บันทึก API Keys
          </button>
        </div>
  );
}
