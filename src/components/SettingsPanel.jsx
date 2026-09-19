export function SettingsPanel({
  tdKeyDraft, setTdKeyDraft,
  fhKeyDraft, setFhKeyDraft,
  geminiKeyDraft, setGeminiKeyDraft,
  tdRateDraft, setTdRateDraft,
  fhRateDraft, setFhRateDraft,
  tdDailyDraft, setTdDailyDraft,
  fhDailyDraft, setFhDailyDraft,
  vaultInfo,
  onClearKeys,
  onSave,
}) {
  const status = vaultInfo?.status || "encrypted";
  const legacyRemains = !!vaultInfo?.legacyRemains;
  const confirmClear = () => {
    if (window.confirm("ลบ API Key ทั้งหมด (Twelve Data / Finnhub / Gemini) ออกจากเบราว์เซอร์นี้? ข้อมูลพอร์ตและ Watchlist จะไม่ถูกลบ")) {
      onClearKeys();
    }
  };
  return (
        <div className="p-4 bg-zinc-900 border-b border-zinc-800 space-y-3">
          <div className="text-xs font-semibold text-zinc-200">⚙️ การตั้งค่า API Key</div>
          <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200 space-y-1">
            <div className="font-semibold">⚠️ API Key ที่เก็บในเบราว์เซอร์ไม่ปลอดภัย 100%</div>
            <div>
              แอปนี้ทำงานในเบราว์เซอร์ล้วน ๆ (ไม่มีเซิร์ฟเวอร์ของตัวเอง) จึงต้องเก็บ Key ไว้ในเครื่องคุณเพื่อเรียก API
              แม้จะเข้ารหัสก่อนบันทึก แต่สคริปต์อันตรายที่ถูกแทรกเข้าหน้าเว็บ (XSS) ส่วนขยายเบราว์เซอร์ที่เป็นอันตราย
              หรือคนที่เข้าถึงเครื่องของคุณได้ ก็ยังดึง Key ไปใช้ได้
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-amber-200/90">
              <li>ใช้ Key แผนฟรี/สิทธิ์ต่ำสุด และอย่านำ Key ที่ผูกบัตรเครดิตหรือใช้กับระบบอื่นมาใส่</li>
              <li>Gemini: จำกัด Key ให้ใช้ได้เฉพาะโดเมนเว็บนี้ (HTTP referrer) ในหน้าจัดการ Key ของ Google</li>
              <li>อย่าใช้บนเครื่องสาธารณะ/เครื่องที่ใช้ร่วมกัน และอย่าแคปหน้าจอหรือแชร์ Key ให้ใคร</li>
              <li>หากสงสัยว่า Key รั่ว ให้เพิกถอน (revoke) แล้วออก Key ใหม่ที่เว็บของผู้ให้บริการทันที</li>
              <li>ไฟล์ "สำรองข้อมูล" ไม่รวม API Key — ต้องกรอก Key ใหม่เมื่อย้ายเครื่อง</li>
            </ul>
          </div>
          {status === "encrypted" && (
            <div className="text-[10px] text-emerald-400/90">
              🔒 Key ถูกเข้ารหัสด้วย Web Crypto (AES-GCM) ก่อนบันทึกในเบราว์เซอร์นี้ — เป็นเพียงอุปสรรคเพิ่ม ไม่ใช่การป้องกันที่สมบูรณ์
            </div>
          )}
          {status === "memory" && (
            <div className="text-[10px] text-red-300">
              ⚠️ เบราว์เซอร์/บริบทนี้เข้ารหัสไม่ได้ (ต้องใช้ HTTPS และ IndexedDB) จึงไม่บันทึก Key ลงเครื่อง — Key จะอยู่ในหน่วยความจำจนกว่าจะปิดแท็บ
            </div>
          )}
          {status === "undecryptable" && (
            <div className="text-[10px] text-red-300">
              ⚠️ ถอดรหัส Key ที่เคยบันทึกไว้ไม่ได้ (ข้อมูลของเบราว์เซอร์อาจถูกล้างบางส่วน) กรุณากรอก Key ใหม่แล้วกดบันทึก
            </div>
          )}
          {legacyRemains && (
            <div className="text-[10px] text-red-300">
              ⚠️ ยังมี Key ที่เคยบันทึกแบบไม่เข้ารหัสค้างอยู่ในเบราว์เซอร์นี้ — กด "ลบ API Keys ออกจากเบราว์เซอร์นี้" เพื่อล้างทิ้ง
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-zinc-400 block mb-1">Twelve Data API Key (หลัก สำหรับราคา & กราฟ)</label>
              <input
                type="password"
                value={tdKeyDraft}
                onChange={(e) => setTdKeyDraft(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 font-mono text-zinc-100"
                placeholder="ใส่ Key Twelve Data"
                autoComplete="off"
                spellCheck={false}
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
                autoComplete="off"
                spellCheck={false}
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
                autoComplete="off"
                spellCheck={false}
              />
              <div className="text-[10px] text-zinc-500 mt-1">
                ใช้สำหรับปุ่ม "อัปโหลดรูปพอร์ต" ในหน้าพอร์ตลงทุน — ขอ Key ได้ที่ aistudio.google.com/apikey — Key ถูกส่งตรงจากเบราว์เซอร์ไปยัง Google เท่านั้น (ไม่ผ่านเซิร์ฟเวอร์ของแอปนี้)
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
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onSave}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-medium"
            >
              บันทึก API Keys
            </button>
            <button
              onClick={confirmClear}
              className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-red-500/50 rounded text-xs text-zinc-400 hover:text-red-300 transition-colors"
            >
              ลบ API Keys ออกจากเบราว์เซอร์นี้
            </button>
          </div>
        </div>
  );
}
