/* ============================================================
   API Key Vault
   ============================================================
   เก็บ API key (Twelve Data / Finnhub / Gemini) แยกจากการตั้งค่าอื่น และไม่เก็บเป็น plaintext

   การทำงาน
   - สร้างกุญแจ AES-GCM 256 บิตแบบ non-extractable (JavaScript อ่านค่าดิบของกุญแจกลับออกมาไม่ได้)
     เก็บไว้ใน IndexedDB
   - เข้ารหัส { td, fh, gemini } ด้วยกุญแจนั้น (IV สุ่มใหม่ทุกครั้งที่บันทึก) แล้วเก็บ ciphertext ไว้ใน
     localStorage คีย์ "us-dash-api-keys-v2" — คนละคีย์กับ "us-dash-keys" ที่เหลือไว้เก็บแค่ค่าโควตา
   - ถ้าใครเปิดดู localStorage / ไฟล์ profile ของเบราว์เซอร์ จะเห็นแค่ ciphertext ไม่ใช่ key

   ข้อจำกัด (ตั้งใจให้ชัด — นี่เป็น "อุปสรรค" ไม่ใช่การป้องกันเด็ดขาด)
   - โค้ดของแอปต้อง "ถอดรหัสเองได้" เพื่อเอา key ไปยิง API ดังนั้นสคริปต์ที่ถูกแทรกเข้ามาในหน้าเว็บ (XSS)
     ก็เรียกฟังก์ชันเดียวกันนี้เพื่อถอดรหัสได้เหมือนกัน การเข้ารหัสกันได้เฉพาะการอ่านข้อมูลดิบจาก storage
     (เช่น เครื่องถูกยึดไฟล์, ส่วนขยายที่อ่าน localStorage อย่างเดียว, ไฟล์สำรอง/sync ที่ก๊อปปี้ localStorage ไป)
   - ต้องใช้ HTTPS (หรือ localhost) + IndexedDB ถ้าไม่รองรับ จะไม่บันทึก key ลงเครื่อง (เก็บในหน่วยความจำ
     ของแท็บเท่านั้น) แทนที่จะถอยไปเก็บ plaintext
   ============================================================ */
import { forgetAllSecrets, registerSecrets } from "../utils/redact.js";

export const SECRET_FIELDS = ["td", "fh", "gemini"];

const VAULT_LS_KEY = "us-dash-api-keys-v2";
const LEGACY_SETTINGS_KEY = "us-dash-keys"; // เดิมเก็บ key ปนกับค่าโควตา (plaintext) — ตอนนี้เหลือแค่ค่าโควตา
const DB_NAME = "us-dash-vault";
const DB_STORE = "kv";
const MASTER_KEY_ID = "master-v1";
const LOCK_NAME = "us-dash-vault";
const AAD = new TextEncoder().encode(VAULT_LS_KEY); // ผูก ciphertext เข้ากับบริบทนี้ (กันเอาไปสลับที่กับข้อมูลอื่น)

/* ---------------- ตัวช่วยจัดการวัตถุ key/settings ---------------- */
const emptySecrets = () => ({ td: "", fh: "", gemini: "" });

export function hasAnySecret(secrets) {
  return !!secrets && SECRET_FIELDS.some((f) => typeof secrets[f] === "string" && secrets[f].trim() !== "");
}

// แยก object เก่า (ที่อาจมี key ปนอยู่) เป็น { secrets, settings }
export function splitSecrets(obj) {
  const secrets = emptySecrets();
  const settings = {};
  for (const [k, v] of Object.entries(obj && typeof obj === "object" ? obj : {})) {
    if (SECRET_FIELDS.includes(k)) secrets[k] = typeof v === "string" ? v.trim() : "";
    else settings[k] = v;
  }
  return { secrets, settings };
}

// ตัด field ที่เป็น key ออก — ใช้ก่อนเขียนลง localStorage ทั่วไปหรือไฟล์สำรอง
export function stripSecrets(obj) {
  return splitSecrets(obj).settings;
}

/* ---------------- สถานะที่ UI ใช้แสดง ---------------- */
// status: "encrypted" = เข้ารหัสและบันทึกในเบราว์เซอร์นี้ | "memory" = เข้ารหัสไม่ได้ เก็บในหน่วยความจำชั่วคราว
//         "undecryptable" = มี ciphertext แต่ถอดรหัสไม่ได้ (กุญแจใน IndexedDB หาย/พัง) ต้องกรอก key ใหม่
// legacyRemains: ยังมี key แบบ plaintext เหลืออยู่ใน "us-dash-keys" (ย้ายเข้า vault ไม่สำเร็จ)
const info = (status, legacyRemains = false) => ({ status, legacyRemains });

/* ---------------- Web Crypto / IndexedDB ---------------- */
function isVaultSupported() {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle?.encrypt === "function" &&
      typeof crypto.getRandomValues === "function" &&
      typeof indexedDB !== "undefined" &&
      typeof localStorage !== "undefined"
    );
  } catch {
    return false;
  }
}

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function idbRun(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      let result;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

// กันสองแท็บสร้างกุญแจหลักพร้อมกันแล้วเขียนทับกัน (จะทำให้ ciphertext ของแท็บแรกถอดไม่ออก)
async function withLock(fn) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return fn();
}

async function getMasterKey({ create }) {
  const existing = await idbRun("readonly", (s) => s.get(MASTER_KEY_ID));
  if (existing) return existing;
  if (!create) return null;
  return withLock(async () => {
    const again = await idbRun("readonly", (s) => s.get(MASTER_KEY_ID));
    if (again) return again;
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idbRun("readwrite", (s) => s.put(key, MASTER_KEY_ID));
    return key;
  });
}

async function encryptSecrets(secrets, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, cryptoKey, plain);
  return { v: 2, alg: "AES-GCM", iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function decryptSecrets(payload, cryptoKey) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(payload.iv), additionalData: AAD },
    cryptoKey,
    fromB64(payload.ct)
  );
  return splitSecrets(JSON.parse(new TextDecoder().decode(plain))).secrets;
}

/* ---------------- สถานะในหน่วยความจำ (ใช้เมื่อเข้ารหัส/บันทึกไม่ได้) ---------------- */
let memorySecrets = emptySecrets();

function readVaultPayload() {
  try {
    const raw = localStorage.getItem(VAULT_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && p.v === 2 && typeof p.iv === "string" && typeof p.ct === "string" ? p : "corrupt";
  } catch {
    return "corrupt";
  }
}

function readLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function legacyHasSecrets() {
  const legacy = readLegacy();
  return !!legacy && hasAnySecret(splitSecrets(legacy).secrets);
}

// เขียน "us-dash-keys" กลับโดยไม่มีฟิลด์ key (คงค่าโควตาไว้)
function purgeLegacySecrets() {
  const legacy = readLegacy();
  if (!legacy) return;
  try {
    localStorage.setItem(LEGACY_SETTINGS_KEY, JSON.stringify(stripSecrets(legacy)));
  } catch { /* เขียนไม่ได้ก็ปล่อยไว้ — legacyRemains จะบอก UI */ }
}

/* ---------------- API ภายนอก ---------------- */

// อ่าน key จาก vault (ไม่แตะข้อมูลเดิมใน us-dash-keys)
async function readVault() {
  if (!isVaultSupported()) return { keys: { ...memorySecrets }, status: "memory" };
  const payload = readVaultPayload();
  if (!payload) return { keys: emptySecrets(), status: "encrypted" };
  if (payload === "corrupt") return { keys: emptySecrets(), status: "undecryptable" };
  try {
    const master = await getMasterKey({ create: false });
    if (!master) return { keys: emptySecrets(), status: "undecryptable" };
    return { keys: await decryptSecrets(payload, master), status: "encrypted" };
  } catch {
    return { keys: emptySecrets(), status: "undecryptable" };
  }
}

// บันทึก key ทั้งชุด (แทนที่ของเดิม) — คืนสถานะสำหรับ UI
export async function saveApiKeys(input) {
  const secrets = splitSecrets(input).secrets;
  registerSecrets(secrets.td, secrets.fh, secrets.gemini);
  memorySecrets = { ...secrets };

  if (!isVaultSupported()) return info("memory", legacyHasSecrets());
  try {
    if (!hasAnySecret(secrets)) {
      localStorage.removeItem(VAULT_LS_KEY);
    } else {
      const master = await getMasterKey({ create: true });
      const payload = await encryptSecrets(secrets, master);
      localStorage.setItem(VAULT_LS_KEY, JSON.stringify(payload));
    }
    return info("encrypted", legacyHasSecrets());
  } catch {
    // ไม่ log รายละเอียด error — กันหลุดไปพร้อมข้อมูลที่เกี่ยวกับ key; ใช้เฉพาะสถานะบอก UI
    return info("memory", legacyHasSecrets());
  }
}

// เติมเฉพาะฟิลด์ที่ไม่ว่างทับของเดิม (ใช้ตอนนำเข้าไฟล์สำรองรุ่นเก่าที่มี key ติดมา)
export async function mergeApiKeys(partial) {
  const current = (await readVault()).keys;
  const incoming = splitSecrets(partial).secrets;
  const merged = { ...current };
  for (const f of SECRET_FIELDS) if (incoming[f]) merged[f] = incoming[f];
  return saveApiKeys(merged);
}

// ลบ key ทั้งหมดออกจากเบราว์เซอร์นี้ (ทั้ง vault, กุญแจหลัก, และ plaintext เก่า) แล้วสร้างกุญแจใหม่ครั้งหน้า
export async function clearApiKeys() {
  memorySecrets = emptySecrets();
  forgetAllSecrets();
  try { localStorage.removeItem(VAULT_LS_KEY); } catch { /* ignore */ }
  purgeLegacySecrets();
  if (isVaultSupported()) {
    try { await idbRun("readwrite", (s) => s.delete(MASTER_KEY_ID)); } catch { /* ignore */ }
  }
  return info(isVaultSupported() ? "encrypted" : "memory", legacyHasSecrets());
}

// เรียกครั้งเดียวตอนแอปเปิด: ย้าย key เก่า (plaintext ใน us-dash-keys) เข้า vault แล้วคืน key ที่ใช้งานได้
export async function initApiKeyVault() {
  const vault = await readVault();
  const legacy = readLegacy();
  const legacySecrets = legacy ? splitSecrets(legacy).secrets : emptySecrets();

  // key เก่าที่ไม่ว่างชนะของใน vault (โค้ดรุ่นใหม่ไม่เคยเขียน key ลง us-dash-keys อีก จึงมีแต่ของรุ่นเก่าเท่านั้น)
  const merged = { ...vault.keys };
  for (const f of SECRET_FIELDS) if (legacySecrets[f]) merged[f] = legacySecrets[f];
  registerSecrets(merged.td, merged.fh, merged.gemini);
  memorySecrets = { ...merged };

  if (!hasAnySecret(legacySecrets)) {
    return { keys: merged, ...info(vault.status, false) };
  }

  // มี plaintext เก่า → เข้ารหัสลง vault แล้ว "ตรวจว่าถอดกลับได้จริง" ก่อนค่อยลบ plaintext ทิ้ง
  // (ไม่ลบถ้าตรวจไม่ผ่าน กัน key ผู้ใช้หายเพราะ IndexedDB ขัดข้องชั่วคราว)
  const saved = await saveApiKeys(merged);
  if (saved.status === "encrypted") {
    const check = await readVault();
    if (check.status === "encrypted" && SECRET_FIELDS.every((f) => check.keys[f] === merged[f])) {
      purgeLegacySecrets();
      return { keys: merged, ...info("encrypted", legacyHasSecrets()) };
    }
  }
  return { keys: merged, ...info("memory", true) };
}
