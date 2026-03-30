import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const DEFAULT_PORT = 4176;
const DEFAULT_LINES = 1000;
const DEFAULT_ITERATIONS = 3;
const HOST = "127.0.0.1";

function parseArgs(argv) {
  const options = {
    lines: DEFAULT_LINES,
    iterations: DEFAULT_ITERATIONS,
    port: DEFAULT_PORT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];

    if (argument === "--lines" && next) {
      options.lines = Number(next);
      index += 1;
      continue;
    }

    if (argument === "--iterations" && next) {
      options.iterations = Number(next);
      index += 1;
      continue;
    }

    if (argument === "--port" && next) {
      options.port = Number(next);
      index += 1;
    }
  }

  return options;
}

async function waitForServer(url, timeoutMs = 20_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {}

    await delay(150);
  }

  throw new Error(`Timed out waiting for benchmark server at ${url}`);
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }

  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function printScenario(result) {
  const mountValues = result.runs.map((run) => run.mountMs);
  const moveValues = result.runs.map((run) => run.moveDownMs);
  const newlineValues = result.runs.map((run) => run.newlineAtTopMs);
  const rowsValues = result.runs.map((run) => run.rowCount);

  console.log(`\n${result.name}`);
  console.log(`  rows: ${rowsValues[0] ?? 0}`);
  console.log(`  mount median: ${formatMs(median(mountValues))}`);
  console.log(`  move 200 lines median: ${formatMs(median(moveValues))}`);
  console.log(`  newline at top median: ${formatMs(median(newlineValues))}`);

  for (const [index, run] of result.runs.entries()) {
    console.log(
      `  run ${index + 1}: mount ${formatMs(run.mountMs)}, move ${formatMs(run.moveDownMs)}, newline ${formatMs(run.newlineAtTopMs)}`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = `http://${HOST}:${options.port}`;
  const playgroundDir = fileURLToPath(new URL("../apps/playground/", import.meta.url));
  const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  const vite = spawn(process.execPath, [viteBin, "--host", HOST, "--port", String(options.port), "--strictPort"], {
    cwd: playgroundDir,
    stdio: "pipe"
  });

  let closed = false;

  vite.once("error", (error) => {
    console.error(error);
  });

  const closeServer = async () => {
    if (closed) {
      return;
    }

    closed = true;
    vite.kill("SIGTERM");
    await delay(150);
  };

  vite.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  vite.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  process.on("SIGINT", async () => {
    await closeServer();
    process.exit(130);
  });

  try {
    await waitForServer(`${serverUrl}/?bench=1`);

    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();
      await page.goto(`${serverUrl}/?bench=1`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(window.__whxBench?.runSuite));

      const results = await page.evaluate(
        async ({ lines, iterations }) => await window.__whxBench.runSuite({ lineCount: lines, iterations }),
        { lines: options.lines, iterations: options.iterations }
      );

      console.log(`\nWHX editor benchmark`);
      console.log(`  lines: ${options.lines}`);
      console.log(`  iterations: ${options.iterations}`);

      for (const result of results.scenarios) {
        printScenario(result);
      }
    } finally {
      await browser.close();
    }
  } finally {
    await closeServer();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
