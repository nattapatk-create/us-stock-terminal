import assert from "node:assert/strict";

// ทดสอบ vault เก็บ API key / redaction / secureFetch / ล้าง URL — รันด้วย `npm run test:keys` (Node 20+ ไม่ต้องติดตั้งอะไรเพิ่ม)
// ใช้ localStorage/IndexedDB จำลองในหน่วยความจำ + Web Crypto จริงของ Node
const SRC = new URL("../src/", import.meta.url);
const imp = (p, q = "") => import(new URL(p, SRC).href + q);

/* ---------- fakes ---------- */
class FakeLS {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  dump() { return JSON.stringify([...this.m.entries()]); }
}
function makeFakeIDB() {
  const dbs = new Map();
  return {
    dbs,
    open(name) {
      const req = {};
      setTimeout(() => {
        let db = dbs.get(name); const isNew = !db;
        if (!db) { db = { stores: new Map() }; dbs.set(name, db); }
        req.result = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore: (n) => { db.stores.set(n, new Map()); },
          transaction() {
            const tx = {};
            tx.objectStore = (n) => {
              const store = db.stores.get(n);
              const op = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess?.(); setTimeout(() => tx.oncomplete?.(), 0); }, 0); return r; };
              return { get: (k) => op(() => store.get(k)), put: (v, k) => op(() => { store.set(k, v); }), delete: (k) => op(() => { store.delete(k); }) };
            };
            return tx;
          },
          close() {},
        };
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}
function setEnv({ idb = true } = {}) {
  const ls = new FakeLS();
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true, writable: true });
  if (idb) Object.defineProperty(globalThis, "indexedDB", { value: makeFakeIDB(), configurable: true, writable: true });
  else delete globalThis.indexedDB;
  return ls;
}

const KEYS = { td: "a1b2c3d4e5f60718293a4b5c6d7e8f90", fh: "cabc123def456ghi789jk0", gemini: "AIzaSyD-EXAMPLEEXAMPLEEXAMPLEEXAMPLE123" };
let n = 0; const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.message]); }
}

/* ---------- redact ---------- */
await test("redactSecrets: query params, Google key, headers", async () => {
  const { redactSecrets } = await imp("utils/redact.js");
  const s = redactSecrets("GET https://api.twelvedata.com/quote?symbol=AAPL&apikey=SECRET123456 failed; https://finnhub.io/api/v1/quote?symbol=X&token=TOKEN987654&x=1 ; ?key=AIzaSyD-EXAMPLEEXAMPLEEXAMPLEEXAMPLE123 x-goog-api-key: AIzaSyD-EXAMPLEEXAMPLEEXAMPLEEXAMPLE123");
  assert.ok(!/SECRET123456|TOKEN987654|AIza/.test(s), s);
  assert.ok(s.includes("symbol=AAPL") && s.includes("x=1"), "non-secret params preserved: " + s);
});
await test("redactSecrets: registered secret values replaced anywhere", async () => {
  const { redactSecrets, registerSecrets } = await imp("utils/redact.js");
  registerSecrets("my-very-secret-value");
  assert.equal(redactSecrets("boom my-very-secret-value boom"), "boom [REDACTED] boom");
});
await test("redactError: keeps original when clean, cleans message+stack when not", async () => {
  const { redactError } = await imp("utils/redact.js");
  const clean = new TypeError("Failed to fetch");
  assert.equal(redactError(clean), clean);
  const dirty = new TypeError("Failed to fetch https://x/?apikey=ABCDEFGH1234");
  const out = redactError(dirty);
  assert.ok(!out.message.includes("ABCDEFGH1234") && !out.stack.includes("ABCDEFGH1234"));
  assert.equal(out.name, "TypeError");
});
await test("secureFetch: rethrown error has no key", async () => {
  const { secureFetch } = await imp("api/secureFetch.js");
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new TypeError(`NetworkError fetching ${u}`); };
  try {
    await assert.rejects(() => secureFetch("https://api.twelvedata.com/quote?symbol=A&apikey=LEAKME123456"), (e) => !/LEAKME123456/.test(e.message + e.stack));
  } finally { globalThis.fetch = orig; }
});
await test("scrubSecretsFromLocation removes apikey/token from search and hash", async () => {
  const { scrubSecretsFromLocation } = await imp("utils/redact.js");
  const state = { pathname: "/us-stock-terminal/", search: "?tab=heatmap&apikey=ZZZ&fh=YYY", hash: "#token=QQQ&x=1" };
  let replaced = null;
  globalThis.window = { location: state, history: { state: null, replaceState: (_s, _t, url) => { replaced = url; } } };
  assert.equal(scrubSecretsFromLocation(), true);
  assert.equal(replaced, "/us-stock-terminal/?tab=heatmap#x=1");
  replaced = null; state.search = "?tab=heatmap"; state.hash = "";
  assert.equal(scrubSecretsFromLocation(), false); assert.equal(replaced, null);
  delete globalThis.window;
});

/* ---------- vault ---------- */
await test("split/strip secrets", async () => {
  const { splitSecrets, stripSecrets, hasAnySecret } = await imp("api/keyVault.js", `?t=${n++}`);
  const { secrets, settings } = splitSecrets({ ...KEYS, tdRate: 8, fhDaily: 0 });
  assert.deepEqual(settings, { tdRate: 8, fhDaily: 0 });
  assert.equal(secrets.td, KEYS.td);
  assert.deepEqual(stripSecrets({ td: "x", tdRate: 3 }), { tdRate: 3 });
  assert.equal(hasAnySecret({ td: "", fh: " ", gemini: "" }), false);
});
await test("vault: roundtrip, ciphertext-only in localStorage, random IV", async () => {
  const ls = setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  const st = await v.saveApiKeys(KEYS);
  assert.equal(st.status, "encrypted");
  const dump1 = ls.dump();
  for (const k of Object.values(KEYS)) assert.ok(!dump1.includes(k), "plaintext key leaked into localStorage");
  assert.ok(ls.getItem("us-dash-api-keys-v2"));
  assert.equal(ls.getItem("us-dash-keys"), null, "must not touch us-dash-keys");
  const first = ls.getItem("us-dash-api-keys-v2");
  await v.saveApiKeys(KEYS);
  assert.notEqual(ls.getItem("us-dash-api-keys-v2"), first, "IV must change per save");
  // fresh module instance (simulates page reload) can decrypt
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  const init = await v2.initApiKeyVault();
  assert.deepEqual(init.keys, KEYS); assert.equal(init.status, "encrypted"); assert.equal(init.legacyRemains, false);
});
await test("vault: master key is non-extractable", async () => {
  setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.saveApiKeys(KEYS);
  const idb = globalThis.indexedDB.dbs.get("us-dash-vault").stores.get("kv");
  const key = idb.get("master-v1");
  assert.equal(key.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("raw", key));
});
await test("migration: legacy plaintext in us-dash-keys moves to vault, rates preserved", async () => {
  const ls = setEnv();
  ls.setItem("us-dash-keys", JSON.stringify({ ...KEYS, tdRate: 12, fhRate: 30, tdDaily: 500, fhDaily: 0 }));
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  const init = await v.initApiKeyVault();
  assert.deepEqual(init.keys, KEYS); assert.equal(init.status, "encrypted"); assert.equal(init.legacyRemains, false);
  const legacy = JSON.parse(ls.getItem("us-dash-keys"));
  assert.deepEqual(legacy, { tdRate: 12, fhRate: 30, tdDaily: 500, fhDaily: 0 });
  for (const k of Object.values(KEYS)) assert.ok(!ls.dump().includes(k));
  // next boot still works
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  assert.deepEqual((await v2.initApiKeyVault()).keys, KEYS);
});
await test("migration is NOT destructive when IndexedDB fails", async () => {
  const ls = setEnv();
  globalThis.indexedDB.open = () => { const r = {}; setTimeout(() => r.onerror?.(), 0); r.error = new Error("blocked"); return r; };
  ls.setItem("us-dash-keys", JSON.stringify({ ...KEYS, tdRate: 8 }));
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  const init = await v.initApiKeyVault();
  assert.deepEqual(init.keys, KEYS, "keys still usable this session");
  assert.equal(init.status, "memory"); assert.equal(init.legacyRemains, true);
  assert.equal(JSON.parse(ls.getItem("us-dash-keys")).td, KEYS.td, "legacy must be kept if migration unverified");
});
await test("unsupported env (no IndexedDB): memory only, nothing new written", async () => {
  const ls = setEnv({ idb: false });
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  const st = await v.saveApiKeys(KEYS);
  assert.equal(st.status, "memory");
  assert.equal(ls.dump().includes(KEYS.td), false); assert.equal(ls.getItem("us-dash-api-keys-v2"), null);
});
await test("lost master key -> undecryptable, keys empty, no throw", async () => {
  const ls = setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.saveApiKeys(KEYS);
  globalThis.indexedDB.dbs.get("us-dash-vault").stores.get("kv").clear();
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  const init = await v2.initApiKeyVault();
  assert.equal(init.status, "undecryptable"); assert.equal(init.keys.td, "");
});
await test("tampered ciphertext -> undecryptable (AES-GCM auth)", async () => {
  const ls = setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.saveApiKeys(KEYS);
  const p = JSON.parse(ls.getItem("us-dash-api-keys-v2")); p.ct = p.ct.slice(0, -4) + (p.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
  ls.setItem("us-dash-api-keys-v2", JSON.stringify(p));
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  assert.equal((await v2.initApiKeyVault()).status, "undecryptable");
});
await test("mergeApiKeys only overwrites non-empty fields (backup import)", async () => {
  setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.saveApiKeys(KEYS);
  await v.mergeApiKeys({ td: "NEWTD-0123456789", fh: "", gemini: "" });
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  const { keys } = await v2.initApiKeyVault();
  assert.equal(keys.td, "NEWTD-0123456789"); assert.equal(keys.fh, KEYS.fh); assert.equal(keys.gemini, KEYS.gemini);
});
await test("clearApiKeys wipes vault, master key and legacy plaintext", async () => {
  const ls = setEnv();
  ls.setItem("us-dash-keys", JSON.stringify({ ...KEYS, tdRate: 8 }));
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.initApiKeyVault();
  const st = await v.clearApiKeys();
  assert.equal(st.legacyRemains, false);
  assert.equal(ls.getItem("us-dash-api-keys-v2"), null);
  assert.equal(globalThis.indexedDB.dbs.get("us-dash-vault").stores.get("kv").size, 0);
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  assert.equal(hasNone((await v2.initApiKeyVault()).keys), true);
  function hasNone(k) { return !k.td && !k.fh && !k.gemini; }
});
await test("parallel first-time saves with Web Locks -> one master key, decryptable", async () => {
  const ls = setEnv();
  let chain = Promise.resolve();
  Object.defineProperty(globalThis.navigator, "locks", { configurable: true, value: { request: (_n, fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; } } });
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await Promise.all([v.saveApiKeys(KEYS), v.saveApiKeys(KEYS)]);
  const v2 = await imp("api/keyVault.js", `?t=${n++}`);
  assert.deepEqual((await v2.initApiKeyVault()).keys, KEYS);
  delete globalThis.navigator.locks;
});

/* ---------- console never sees keys during a simulated failing API call ---------- */
await test("registered secrets are scrubbed from any error surfaced via secureFetch", async () => {
  setEnv();
  const v = await imp("api/keyVault.js", `?t=${n++}`);
  await v.saveApiKeys(KEYS);
  const { secureFetch } = await imp("api/secureFetch.js");
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(`weird proxy error containing ${KEYS.fh} and ${KEYS.td}`); };
  try {
    await assert.rejects(() => secureFetch("https://x"), (e) => !e.message.includes(KEYS.fh) && !e.message.includes(KEYS.td));
  } finally { globalThis.fetch = orig; }
});

for (const r of results) console.log(r[0], "-", r[1], r[2] ? "\n     " + r[2] : "");
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
