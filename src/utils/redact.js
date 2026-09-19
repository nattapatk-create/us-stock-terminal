/* ------------------------------------------------------------
   Redaction ของ API key
   ------------------------------------------------------------
   ใช้กัน key หลุดออกไปกับ (1) ข้อความ error / stack trace ที่ถูก log ลง console หรือโชว์ใน UI
   และ (2) URL ของหน้าเว็บ (address bar) ที่ผู้ใช้อาจคัดลอกไปแชร์

   หมายเหตุ: Twelve Data / Finnhub / Gemini รับ key ผ่าน query string (`apikey=`, `token=`, `key=`)
   ทำให้ URL ของ "คำขอ API" มี key อยู่ในตัว (เห็นได้ใน DevTools > Network) — เลี่ยงไม่ได้ตราบใดที่
   ยิงจากเบราว์เซอร์ตรง ๆ ดังนั้นสิ่งที่ทำได้คือไม่ให้ URL นั้นรั่วไปอยู่ในที่อื่น (log / error / URL หน้าเว็บ)
   ------------------------------------------------------------ */

const REDACTED = "[REDACTED]";
const MIN_SECRET_LEN = 8; // สั้นกว่านี้ไม่ใช่ key จริง และเสี่ยงไปแทนที่คำทั่วไปในข้อความโดยไม่ตั้งใจ

// ค่า key จริงที่แอปรู้จัก (ลงทะเบียนตอนโหลด/บันทึก key) — ใช้แทนที่แบบตรงตัว ไม่ว่าจะโผล่ในรูปแบบไหน
const knownSecrets = new Set();

export function registerSecrets(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length >= MIN_SECRET_LEN) knownSecrets.add(v.trim());
  }
}

export function forgetAllSecrets() {
  knownSecrets.clear();
}

// พารามิเตอร์ที่มักเป็น credential ใน query string / hash
const QUERY_PARAM_RE = /([?&#](?:api[_-]?key|apikey|token|access[_-]?token|key)=)[^&#\s"'<>]+/gi;
// รูปแบบ key ของ Google (Gemini) — ขึ้นต้น AIza
const GOOGLE_KEY_RE = /AIza[0-9A-Za-z_-]{30,}/g;
// header ที่พก credential
const HEADER_RE = /\b(x-goog-api-key|x-finnhub-token|authorization)(["']?\s*[:=]\s*["']?)(?:apikey\s+|bearer\s+)?[^\s"',;}]+/gi;

export function redactSecrets(text) {
  if (typeof text !== "string" || text === "") return text;
  let out = text
    .replace(QUERY_PARAM_RE, `$1${REDACTED}`)
    .replace(GOOGLE_KEY_RE, REDACTED)
    .replace(HEADER_RE, `$1$2${REDACTED}`);
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

// คืน Error ตัวเดิมถ้าไม่มีอะไรต้องปิดบัง (คง identity/stack เดิมไว้ให้ debug) — ถ้ามี key ติดมา
// ในข้อความหรือ stack จะคืน Error ตัวใหม่ที่ถูกล้างแล้วแทน
export function redactError(err) {
  if (typeof err === "string") return redactSecrets(err);
  if (!(err instanceof Error)) return err;
  const message = redactSecrets(err.message);
  const stack = typeof err.stack === "string" ? redactSecrets(err.stack) : err.stack;
  if (message === err.message && stack === err.stack) return err;
  const clean = new Error(message);
  clean.name = err.name;
  if (stack !== undefined) clean.stack = stack;
  return clean;
}

/* ------------------------------------------------------------
   ล้าง credential ออกจาก URL ของหน้าเว็บ
   ------------------------------------------------------------
   แอปนี้ไม่เคยอ่านหรือเขียน key ผ่าน URL หน้าเว็บ แต่ถ้ามีคนเปิดลิงก์ที่แนบ ?apikey=... มา (หรือเผลอ
   วางลงเอง) ก็ให้ลบทิ้งจาก address bar ทันทีด้วย history.replaceState เพื่อไม่ให้ค้างอยู่ในประวัติ/ถูกคัดลอกไปแชร์ต่อ
   ------------------------------------------------------------ */
const SENSITIVE_PARAM_RE = /^(?:api[_-]?key|apikey|token|access[_-]?token|key|td|fh|gemini)$/i;

function scrubParamString(raw) {
  const params = new URLSearchParams(raw);
  let changed = false;
  for (const name of [...params.keys()]) {
    if (SENSITIVE_PARAM_RE.test(name)) {
      params.delete(name);
      changed = true;
    }
  }
  return { changed, value: params.toString() };
}

export function scrubSecretsFromLocation() {
  try {
    if (typeof window === "undefined" || !window.history?.replaceState) return false;
    const { pathname, search, hash } = window.location;

    const s = scrubParamString(search.replace(/^\?/, ""));
    // hash แบบ "#a=b&c=d" (ไม่ใช่ "#/route") ก็ล้างด้วย
    const h = hash.length > 1 && !hash.startsWith("#/") && hash.includes("=")
      ? scrubParamString(hash.slice(1))
      : { changed: false, value: hash.slice(1) };

    if (!s.changed && !h.changed) return false;
    const next = pathname + (s.value ? `?${s.value}` : "") + (h.value ? `#${h.value}` : "");
    window.history.replaceState(window.history.state, "", next);
    return true;
  } catch {
    return false;
  }
}
