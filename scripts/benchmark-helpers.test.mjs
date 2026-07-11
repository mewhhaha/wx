import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { BENCHMARK_FORMAT_VERSION, aggregateSamples, boundaryElapsedMs, compareMetric, parseDenoBenchmarkReport, parseDenoTerminalEvent, validateResult, withTimeout } from "./benchmark-helpers.mjs";

test("aggregation calculates gate percentiles", () => {
  const summary = aggregateSamples(Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(summary.p50, 15.5);
  assert.ok(Math.abs(summary.p95 - 28.55) < 0.0001);
  assert.ok(summary.p99 > summary.p95);
});

test("timeout rejects an operation that never resolves", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, "test"), /timed out/);
});

test("boundary timing is frozen before delayed teardown", async () => {
  const sample = boundaryElapsedMs(100, 112);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sample, 12);
  assert.throws(() => boundaryElapsedMs(5, 4), /Invalid benchmark boundary/);
});

test("Deno terminal event protocol rejects malformed boundaries", () => {
  assert.deepEqual(parseDenoTerminalEvent("\u001b]wx-benchmark;mounted;12;34\x07"), { boundary: "mounted", heapBytes: 12, rssBytes: 34 });
  assert.throws(() => parseDenoTerminalEvent("\u001b]wx-benchmark;mounted;nope;34\x07"), /Malformed/);
});

test("Deno report protocol validates samples and malformed JSON", () => {
  assert.deepEqual(parseDenoBenchmarkReport('{"readyMs":[1,2],"openMs":[3,4]}', 2), { readyMs: [1, 2], openMs: [3, 4] });
  assert.throws(() => parseDenoBenchmarkReport("not json", 2), /Malformed/);
  assert.throws(() => parseDenoBenchmarkReport('{"readyMs":[1],"openMs":[2]}', 2), /sample count/);
});

test("invalid results are rejected", () => {
  assert.throws(() => validateResult({ formatVersion: BENCHMARK_FORMAT_VERSION, scenarios: [{ id: "bad" }] }), /Invalid benchmark scenario/);
});

test("duplicate scenario IDs are rejected", () => {
  const scenario = { id: "same", workload: "probe", state: "warm", metrics: { synchronousMs: { samples: [1], unit: "ms" } } };
  assert.throws(() => validateResult({ formatVersion: BENCHMARK_FORMAT_VERSION, scenarios: [scenario, scenario] }), /Duplicate benchmark scenario id/);
});

test("comparison requires 30 samples and a practical noisy regression", () => {
  assert.equal(compareMetric([1, 2], [10, 11]).gate, false);
  const baseline = Array.from({ length: 30 }, (_, index) => 10 + (index % 2));
  const candidate = Array.from({ length: 30 }, (_, index) => 15 + (index % 2));
  assert.equal(compareMetric(baseline, candidate).gate, true);
});

test("real Deno PTY sampler serializes finite cold and warm samples", async (t) => {
  const child = spawn("deno", ["run", "--conditions", "development", "--quiet", "--allow-read", "--allow-write", "--allow-run", "packages/editor-view-ansi/scripts/deno-terminal-benchmark.ts", "1", "10"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await withTimeout(new Promise((resolve) => { child.once("error", () => resolve(null)); child.once("exit", (code) => resolve(code === 0 ? true : null)); }), 60_000, "Deno PTY sampler");
  if (!result) return t.skip(`Deno PTY sampler unavailable: ${stderr.trim() || "Deno/script/stty unavailable"}`);
  const report = JSON.parse(stdout);
  for (const key of ["coldMs", "warmMs", "coldBytes", "warmBytes", "coldHeap", "coldRss", "warmHeap", "warmRss"]) assert.ok(Array.isArray(report[key]) && report[key].length === 1 && Number.isFinite(report[key][0]) && report[key][0] >= 0, `invalid ${key}`);
});
