import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const q = await import(new URL("../src/utils/toastQueue.js", import.meta.url).href);

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.stack]); }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// ---- เกณฑ์ตรวจรับ: ไม่มี alert() เหลือในโค้ด ----
await test("ไม่มีการเรียก alert() / window.alert() เหลือใน src/", () => {
  const CALL = /(?<![\w$])(?:(?:window|globalThis|self)\.)?alert\s*\(/;
  const hits = [];
  for (const file of walk(SRC_DIR).filter((f) => /\.(js|jsx)$/.test(f))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (CALL.test(line)) hits.push(`${path.relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

// ---- ตรรกะคิว ----
await test("createToast: type ผิด -> info, duration ตาม type, error อยู่นานกว่า success", () => {
  assert.equal(q.createToast({ type: "nope", message: "x" }, "1").type, "info");
  assert.equal(q.createToast({ type: "success", message: "x" }, "1").duration, q.DEFAULT_DURATION_MS.success);
  assert.ok(q.DEFAULT_DURATION_MS.error > q.DEFAULT_DURATION_MS.success);
  assert.equal(q.createToast({ type: "info", message: "x", duration: 1234 }, "1").duration, 1234);
  assert.equal(q.createToast({ type: "info", message: "x", duration: 0 }, "1").duration, 0, "0 = ค้างจนกว่าจะปิดเอง");
  assert.equal(q.createToast("แค่ข้อความ", "1").message, "แค่ข้อความ");
});

await test("createToast: รับ Error ได้ และ redact API key ก่อนแสดงเสมอ", () => {
  const key = "AIza" + "a".repeat(35);
  const t = q.createToast({ type: "error", message: new Error(`request failed ?key=abc12345678 ${key}`) }, "1");
  assert.ok(!t.message.includes(key));
  assert.ok(!t.message.includes("abc12345678"));
  assert.ok(t.message.includes("[REDACTED]"));
});

await test("pushToast: toast เหมือนกันเป๊ะไม่ซ้อนกัน (ใบใหม่แทนใบเก่า)", () => {
  let list = [];
  list = q.pushToast(list, q.createToast({ type: "warning", message: "ซ้ำ" }, "a"));
  list = q.pushToast(list, q.createToast({ type: "warning", message: "ซ้ำ" }, "b"));
  assert.deepEqual(list.map((t) => t.id), ["b"]);
  list = q.pushToast(list, q.createToast({ type: "error", message: "ซ้ำ" }, "c"));
  assert.equal(list.length, 2, "type ต่างกัน = คนละอัน");
});

await test("pushToast: เกินเพดานแล้วตัวเก่าสุดถูกดันออก", () => {
  let list = [];
  for (let i = 0; i < q.MAX_VISIBLE_TOASTS + 3; i++) {
    list = q.pushToast(list, q.createToast({ type: "info", message: `m${i}` }, `id${i}`));
  }
  assert.equal(list.length, q.MAX_VISIBLE_TOASTS);
  assert.equal(list[list.length - 1].message, `m${q.MAX_VISIBLE_TOASTS + 2}`);
  assert.equal(list[0].message, "m3");
});

await test("markLeaving / removeToast", () => {
  let list = q.pushToast([], q.createToast({ message: "a" }, "a"));
  list = q.pushToast(list, q.createToast({ message: "b" }, "b"));
  list = q.markLeaving(list, "a");
  assert.equal(list.find((t) => t.id === "a").leaving, true);
  assert.equal(list.find((t) => t.id === "b").leaving, false);
  list = q.removeToast(list, "a");
  assert.deepEqual(list.map((t) => t.id), ["b"]);
});

for (const r of results) console.log(r[0], "-", r[1], r[2] ? "\n     " + r[2] : "");
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
