import assert from "node:assert/strict";
const SRC = new URL("../src/", import.meta.url);
const imp = (p, q = "") => import(new URL(p, SRC).href + q);

let n = 0; const results = [];
async function test(name, fn) {
  try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, e.stack]); }
}

function mockRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

await test("tdRequest: 401 -> ApiError isAuthError, no retry", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return mockRes(401, { message: "invalid api key" }); };
  await assert.rejects(
    () => tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 2 }),
    (e) => e.isAuthError === true && e.isRateLimited === false && e.isQuotaExhausted === false
  );
  assert.equal(calls, 1, "should not retry on 401");
});

await test("tdRequest: 429 exhausts retries -> isRateLimited", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return mockRes(429, { code: 429, message: "run out of API credits" }); };
  await assert.rejects(
    () => tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 1 }),
    (e) => e.isRateLimited === true
  );
  assert.equal(calls, 2, "should retry once then throw");
});

await test("tdRequest: 500 -> isServerError after retries", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => mockRes(503, {});
  await assert.rejects(
    () => tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 0 }),
    (e) => e.isServerError === true
  );
});

await test("tdRequest: JSON parse failure -> isParseError", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token"); } });
  await assert.rejects(
    () => tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 0 }),
    (e) => e.isParseError === true
  );
});

await test("tdRequest: network failure (fetch throws) -> isNetworkError", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    () => tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x?apikey=SECRET", init: undefined}) }, { retries: 0 }),
    (e) => e.isNetworkError === true && !e.message.includes("SECRET")
  );
});

await test("tdRequest: success -> returns {data, res}, friendly message unaffected", async () => {
  const { tdRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => mockRes(200, { close: "123.45" });
  const { data, res } = await tdRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 0 });
  assert.equal(data.close, "123.45");
  assert.equal(res.status, 200);
});

await test("fhRequest: 401 -> isAuthError", async () => {
  const { fhRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => mockRes(401, { error: "Invalid API key" });
  await assert.rejects(
    () => fhRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 1 }),
    (e) => e.isAuthError === true
  );
});

await test("fhRequest: 403 rate-limit-like message -> isRateLimited (not auth)", async () => {
  const { fhRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => mockRes(403, { error: "API limit reached please try again later" });
  await assert.rejects(
    () => fhRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 0 }),
    (e) => e.isRateLimited === true && e.isAuthError === false
  );
});

await test("fhRequest: 403 with auth-like message -> isAuthError", async () => {
  const { fhRequest } = await imp("api/priceSeries.js", `?t=${n++}`);
  const { __resetHeaderAuthProbeForTests } = await imp("api/authRequest.js", `?t=${n++}`);
  __resetHeaderAuthProbeForTests();
  globalThis.fetch = async () => mockRes(403, { error: "You don't have access to this resource" });
  await assert.rejects(
    () => fhRequest({ header: () => ({url:"https://x", init:{}}), query: () => ({url:"https://x", init:{}}) }, { retries: 0 }),
    (e) => e.isAuthError === true
  );
});

for (const r of results) console.log(r[0], "-", r[1], r[2] ? "\n     " + r[2] : "");
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
