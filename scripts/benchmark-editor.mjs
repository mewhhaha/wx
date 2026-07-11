import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { BENCHMARK_FORMAT_VERSION, aggregateSamples, compareMetric, validateResult, withTimeout } from "./benchmark-helpers.mjs";
import { runDenoBenchmarks, runNodeBenchmarks, runTreeSitterBenchmarks } from "./benchmark-node.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HOST = "127.0.0.1";
function args(argv) {
  const result = { mode: "smoke", samples: 30, port: 41879, out: "benchmarks/results/latest.json", baseline: "benchmarks/baselines/editor-v1.json", candidate: null, lines: null };
  for (let i = 0; i < argv.length; i += 1) { const value = argv[i + 1]; if (argv[i] === "--mode") { result.mode = value; i++; } else if (argv[i] === "--samples") { result.samples = Number(value); i++; } else if (argv[i] === "--port") { result.port = Number(value); i++; } else if (argv[i] === "--out") { result.out = value; i++; } else if (argv[i] === "--baseline") { result.baseline = value; i++; } else if (argv[i] === "--candidate") { result.candidate = value; i++; } else if (argv[i] === "--lines") { result.lines = Number(value); i++; } }
  if (!["smoke", "full", "compare"].includes(result.mode) || !Number.isInteger(result.samples) || result.samples < 1) throw new Error("Use --mode smoke|full|compare and a positive --samples");
  return result;
}
async function waitForServer(url, timeoutMs = 20_000) { const start = Date.now(); while (Date.now() - start < timeoutMs) { try { if ((await fetch(url)).ok) return; } catch {} await delay(100); } throw new Error(`Timed out waiting for benchmark server at ${url}`); }
function summaryMetric(metric) { if (metric === null) return null; return { ...metric, ...aggregateSamples(metric.samples) }; }
function scenarioId(scenario) { return scenario.id.endsWith(`.${scenario.fixture}`) ? scenario.id : `${scenario.id}.${scenario.fixture}`; }
function enrich(raw) {
  const scenarios = raw.scenarios.map((scenario) => ({ ...scenario, id: scenarioId(scenario), metrics: Object.fromEntries(Object.entries(scenario.metrics).map(([name, metric]) => [name, summaryMetric(metric)])) }));
  validateResult({ formatVersion: raw.formatVersion, scenarios });
  return { formatVersion: BENCHMARK_FORMAT_VERSION, recordedAt: new Date().toISOString(), runtime: { node: process.version, browser: "Chromium (Playwright bundled)", platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? "unknown" }, scenarios };
}
async function runBrowser(options) {
  const playground = path.join(ROOT, "apps/playground"); const viteBin = path.join(ROOT, "node_modules/vite/bin/vite.js");
  const vite = spawn(process.execPath, [viteBin, "--host", HOST, "--port", String(options.port), "--strictPort"], { cwd: playground, stdio: "inherit" });
  const close = async () => { if (!vite.killed) vite.kill("SIGTERM"); await delay(100); };
  try {
    const url = `http://${HOST}:${options.port}`; await waitForServer(`${url}/?bench=1`);
    const browser = await chromium.launch();
    try { const page = await browser.newPage(); await page.goto(`${url}/?bench=1`, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => Boolean(window.__wxBench?.runSuite));
      const lineCounts = options.lines ? [options.lines] : options.mode === "full" ? [100, 1000, 5000, 20000] : [1000];
      const suites = []; for (const lineCount of lineCounts) suites.push(await withTimeout(page.evaluate(({ lineCount, iterations, suite }) => window.__wxBench.runSuite({ lineCount, iterations, suite }), { lineCount, iterations: options.samples, suite: options.mode }), 15 * 60_000, `${lineCount}-line suite`));
      return { formatVersion: BENCHMARK_FORMAT_VERSION, scenarios: suites.flatMap((suite) => suite.scenarios) };
    } finally { await browser.close(); }
  } finally { await close(); }
}
function indexScenarios(result) {
  const indexed = new Map();
  for (const scenario of result.scenarios) {
    if (indexed.has(scenario.id)) throw new Error(`Duplicate benchmark scenario id in comparison input: ${scenario.id}`);
    indexed.set(scenario.id, scenario);
  }
  return indexed;
}
async function compare(options) {
  const baseline = JSON.parse(await readFile(path.resolve(ROOT, options.baseline), "utf8")); const candidate = JSON.parse(await readFile(path.resolve(ROOT, options.candidate ?? options.out), "utf8"));
  const candidateById = indexScenarios(candidate);
  const failures = [];
  for (const scenario of baseline.scenarios) {
    const candidateScenario = candidateById.get(scenario.id);
    if (!candidateScenario) {
      failures.push(`${scenario.id}: required scenario is missing`);
      continue;
    }
    for (const [name, base] of Object.entries(scenario.metrics ?? {})) {
      if (base === null) continue;
      const next = candidateScenario?.metrics?.[name];
      if (!base?.samples || base.samples.length < 30) {
        failures.push(`${scenario.id}/${name}: baseline requires at least 30 samples`);
        continue;
      }
      if (!next?.samples || next.samples.length < 30) {
        failures.push(`${scenario.id}/${name}: candidate requires at least 30 samples`);
        continue;
      }
      const result = compareMetric(base.samples, next.samples);
      if (result.gate) failures.push(`${scenario.id}/${name}: +${result.percent.toFixed(1)}% (${result.delta.toFixed(2)} ms)`);
    }
    for (const [name, budget] of Object.entries(scenario.budgets ?? {})) {
      const next = candidateScenario?.metrics?.[name];
      if (!next?.samples || next.samples.length < 30) {
        if (!(name in (scenario.metrics ?? {}))) failures.push(`${scenario.id}/${name}: candidate requires at least 30 samples`);
        continue;
      }
      if (next.p95 > budget) failures.push(`${scenario.id}/${name}: p95 ${next.p95.toFixed(2)} ms exceeds ${budget} ms budget`);
    }
  }
  if (failures.length) throw new Error(`Statistically meaningful regressions:\n${failures.join("\n")}`);
  console.log("Benchmark comparison passed (no practical regression beyond baseline noise).");
}
async function main() {
  const options = args(process.argv.slice(2));
  if (options.mode === "compare") return compare(options);
  const browser = await runBrowser(options);
  const lineCounts = options.lines ? [options.lines] : options.mode === "full" ? [100, 1000, 5000, 20000] : [1000];
  // Isolate measured lanes and fixture sizes: concurrent Node, worker, or PTY
  // work would contaminate latency and process-memory samples.
  const nonBrowser = [];
  for (const lineCount of lineCounts) {
    nonBrowser.push(...await runNodeBenchmarks({ samples: options.samples, lineCount }));
    nonBrowser.push(...await runTreeSitterBenchmarks({ samples: options.samples, lineCount }));
    nonBrowser.push(...await runDenoBenchmarks({ samples: options.samples, lineCount }));
  }
  const result = enrich({ formatVersion: BENCHMARK_FORMAT_VERSION, scenarios: [...browser.scenarios, ...nonBrowser] });
  const output = path.resolve(ROOT, options.out);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${result.scenarios.length} scenarios to ${path.relative(ROOT, output)}`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
