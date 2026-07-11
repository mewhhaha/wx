import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parseDenoBenchmarkReport, parseDenoTerminalEvent, withTimeout } from "./benchmark-helpers.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const metric = (samples, unit = "ms") => ({ samples, unit });
const now = () => performance.now();
const fixtureName = (lineCount) => `${lineCount}-line-typescript`;
const source = (lines) => Array.from({ length: lines }, (_, i) => `const value${i} = ${i};`).join("\n");
const scenario = (id, workload, state, fixture, metrics, capabilities = {}) => ({ id: `${id}.${fixture}`, workload, state, fixture, metrics, capabilities });
const emptyVisualMetrics = { nextPaintMs: null, settledMs: null };

const upperBound = (values, target) => {
  let low = 0, high = values.length;
  while (low < high) { const middle = (low + high) >>> 1; if (values[middle] <= target) low = middle + 1; else high = middle; }
  return low;
};
const createLineStarts = (text) => { const starts = [0]; for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) starts.push(index + 1); return starts; };
const editIncrementallyIndexedString = (text, starts, at, insert) => {
  const nextText = text.slice(0, at) + insert + text.slice(at);
  const firstShifted = upperBound(starts, at);
  const nextStarts = starts.slice();
  for (let index = firstShifted; index < nextStarts.length; index += 1) nextStarts[index] += insert.length;
  // Random access forces engines that use lazy concatenation to realize the edited string.
  if (nextText.charAt(at) !== insert.charAt(0)) throw new Error("Incrementally indexed string candidate produced invalid text");
  return { text: nextText, starts: nextStarts, shiftedLineStarts: nextStarts.length - firstShifted };
};

const countNewlines = (text) => { let count = 0; for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) count += 1; return count; };
const ropeLeaf = (text, counters) => { if (counters) counters.nodes += 1; return { kind: "leaf", text, length: text.length, newlines: countNewlines(text) }; };
const ropeBranch = (left, right, counters) => { if (!left) return right; if (!right) return left; if (counters) counters.nodes += 1; return { kind: "branch", left, right, length: left.length + right.length, newlines: left.newlines + right.newlines }; };
const buildRope = (text, chunkSize = 4096) => {
  let level = [];
  for (let index = 0; index < text.length; index += chunkSize) level.push(ropeLeaf(text.slice(index, index + chunkSize)));
  while (level.length > 1) { const next = []; for (let index = 0; index < level.length; index += 2) next.push(level[index + 1] ? ropeBranch(level[index], level[index + 1]) : level[index]); level = next; }
  return level[0] ?? ropeLeaf("");
};
const insertRope = (node, at, insert, counters) => {
  if (node.kind === "leaf") {
    const before = at > 0 ? ropeLeaf(node.text.slice(0, at), counters) : null;
    const added = insert ? ropeLeaf(insert, counters) : null;
    const after = at < node.length ? ropeLeaf(node.text.slice(at), counters) : null;
    return ropeBranch(ropeBranch(before, added, counters), after, counters);
  }
  if (at <= node.left.length) return ropeBranch(insertRope(node.left, at, insert, counters), node.right, counters);
  return ropeBranch(node.left, insertRope(node.right, at - node.left.length, insert, counters), counters);
};
const ropeCharAt = (node, at) => node.kind === "leaf" ? node.text.charAt(at) : at < node.left.length ? ropeCharAt(node.left, at) : ropeCharAt(node.right, at - node.left.length);

async function modules() {
  const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
  const [core, controller, ansi] = await Promise.all([
    load("packages/editor-core/dist/index.js"),
    load("packages/editor-controller/dist/index.js"),
    load("packages/editor-view-ansi/dist/index.js")
  ]);
  return { core, controller, ansi };
}

/** A write sink makes frame bytes and key-to-write observable without a TTY. */
function createWriteSink() {
  let bytes = 0;
  return { write(text) { bytes += Buffer.byteLength(text); }, takeBytes() { const value = bytes; bytes = 0; return value; } };
}

/** Resolves writes on the next event-loop check, making writer acceptance observable. */
function createAsyncAcceptedWriteSink() {
  let bytes = 0;
  return {
    write(text) {
      return new Promise((resolve) => setImmediate(() => { bytes += Buffer.byteLength(text); resolve(); }));
    },
    takeBytes() { const value = bytes; bytes = 0; return value; }
  };
}

export async function runNodeBenchmarks({ samples, lineCount }) {
  const { core, controller, ansi } = await modules();
  const fixture = fixtureName(lineCount);
  const text = source(lineCount);
  const candidateLineStarts = createLineStarts(text);
  const candidateRope = buildRope(text);
  const transactionSamples = [], frameSamples = [], frameBytes = [], keyWriteSamples = [], keyWriteBytes = [];
  const historySamples = [], historyRetainedBytes = [], historyEntries = [], rssSamples = [], heapSamples = [];
  const documentEditSamples = [], documentEditIndexedBytes = [], documentEditScannedCodeUnits = [];
  const documentEditTouchedPieces = [], documentEditMetadataBytes = [], documentEditPieceCount = [];
  const indexedStringEditSamples = [], indexedStringRetainedBytes = [], indexedStringShiftedStarts = [];
  const ropeEditSamples = [], ropeCreatedNodes = [], ropeMetadataBytes = [];
  const viewportSizes = [{ cols: 200, rows: 60 }, { cols: 240, rows: 80 }];
  const viewport = new Map(viewportSizes.map((size) => [`${size.cols}x${size.rows}`, { ...size, frame: [], frameBytes: [], key: [], keyBytes: [] }]));
  const acceptedViewport = new Map([{ cols: 100, rows: 30 }, ...viewportSizes].map((size) => [`${size.cols}x${size.rows}`, { ...size, elapsed: [], bytes: [] }]));

  for (let sample = 0; sample < samples; sample += 1) {
    const snapshotHistory = controller.createSnapshotHistory();
    const editor = controller.createEditorController({ value: text, history: snapshotHistory });
    const document = core.createTextDocument(text);
    let start = now();
    const editedDocument = document.applyChanges([{ from: Math.floor(document.length / 2), to: Math.floor(document.length / 2), insert: "x" }]);
    documentEditSamples.push(now() - start);
    const storageStats = core.getDocumentStorageStats(editedDocument);
    documentEditIndexedBytes.push(storageStats.lastEditIndexedBytes);
    documentEditScannedCodeUnits.push(storageStats.lastEditScannedCodeUnits);
    documentEditTouchedPieces.push(storageStats.lastEditTouchedPieces);
    documentEditMetadataBytes.push(storageStats.lastEditMetadataBytes);
    documentEditPieceCount.push(storageStats.pieceCount);
    if (storageStats.textMaterialized) throw new Error("Single-character edit unexpectedly materialized document.text");

    start = now();
    const indexedString = editIncrementallyIndexedString(text, candidateLineStarts, Math.floor(text.length / 2), "x");
    indexedStringEditSamples.push(now() - start);
    indexedStringRetainedBytes.push(indexedString.text.length * 2 + indexedString.starts.length * 8);
    indexedStringShiftedStarts.push(indexedString.shiftedLineStarts);

    const ropeCounters = { nodes: 0 };
    start = now();
    const editedRope = insertRope(candidateRope, Math.floor(text.length / 2), "x", ropeCounters);
    ropeEditSamples.push(now() - start);
    if (ropeCharAt(editedRope, Math.floor(text.length / 2)) !== "x") throw new Error("Rope candidate produced invalid text");
    ropeCreatedNodes.push(ropeCounters.nodes);
    ropeMetadataBytes.push(ropeCounters.nodes * 64);
    start = now();
    for (let move = 0; move < 200; move += 1) await editor.handleKeyInput({ key: "j" });
    transactionSamples.push(now() - start);

    const sink = createWriteSink();
    const mirror = ansi.createAnsiEditorMirror({ controller: editor, write: sink.write, cols: 100, rows: 30, enterAltScreen: false });
    start = now();
    mirror.renderNow();
    frameSamples.push(now() - start);
    frameBytes.push(sink.takeBytes());

    start = now();
    await editor.handleKeyInput({ key: "i", text: "i", source: "ansi" });
    await editor.handleKeyInput({ key: "x", text: "x", source: "ansi" });
    mirror.renderNow();
    keyWriteSamples.push(now() - start);
    keyWriteBytes.push(sink.takeBytes());
    mirror.destroy();

    const before = process.memoryUsage();
    start = now();
    // A single controller receives a sustained edit session, so retained snapshots are measured.
    for (let edit = 0; edit < 250; edit += 1) {
      await editor.handleKeyInput({ key: "i", text: "i" });
      await editor.handleKeyInput({ key: "x", text: "x" });
      await editor.handleKeyInput({ key: "Escape" });
    }
    historySamples.push(now() - start);
    const retained = snapshotHistory.getStats?.();
    if (retained && retained.retainedBytes > retained.maxRetainedBytes) throw new Error("Snapshot history exceeded its retained-byte budget");
    historyRetainedBytes.push(retained?.retainedBytes ?? 0);
    historyEntries.push(retained?.totalEntries ?? 0);
    const after = process.memoryUsage();
    rssSamples.push(Math.max(0, after.rss - before.rss));
    heapSamples.push(Math.max(0, after.heapUsed - before.heapUsed));

    // Keep the legacy 100x30 scenarios above stable, then exercise the larger
    // real frame dimensions independently with the same synchronous write sink.
    for (const entry of viewport.values()) {
      const viewportEditor = controller.createEditorController({ value: text });
      const viewportSink = createWriteSink();
      const viewportMirror = ansi.createAnsiEditorMirror({ controller: viewportEditor, write: viewportSink.write, cols: entry.cols, rows: entry.rows, enterAltScreen: false });
      start = now();
      viewportMirror.renderNow();
      entry.frame.push(now() - start); entry.frameBytes.push(viewportSink.takeBytes());
      start = now();
      await viewportEditor.handleKeyInput({ key: "i", text: "i", source: "ansi" });
      await viewportEditor.handleKeyInput({ key: "x", text: "x", source: "ansi" });
      viewportMirror.renderNow();
      entry.key.push(now() - start); entry.keyBytes.push(viewportSink.takeBytes());
      viewportMirror.destroy();
    }

    for (const entry of acceptedViewport.values()) {
      const acceptedEditor = controller.createEditorController({ value: text });
      const acceptedSink = createAsyncAcceptedWriteSink();
      const acceptedMirror = ansi.createAnsiEditorMirror({ controller: acceptedEditor, write: acceptedSink.write, cols: entry.cols, rows: entry.rows, enterAltScreen: false });
      acceptedMirror.mount();
      await acceptedMirror.whenIdle();
      acceptedSink.takeBytes();
      start = now();
      acceptedMirror.renderNow();
      await acceptedMirror.whenIdle();
      entry.elapsed.push(now() - start);
      entry.bytes.push(acceptedSink.takeBytes());
      acceptedMirror.destroy();
      await acceptedMirror.whenIdle();
    }
  }

  return [
    scenario("controller.transactions.motion-200", "headless controller transaction and motion", "warm", fixture, { synchronousMs: metric(transactionSamples), ...emptyVisualMetrics, outputBytes: null, heapBytes: null, rssBytes: null, workerMessageBytes: null }),
    scenario("ansi.frame-construction", "ANSI frame construction", "warm", fixture, { synchronousMs: metric(frameSamples), ...emptyVisualMetrics, outputBytes: metric(frameBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true }),
    scenario("ansi.key-to-write", "ANSI key transaction through rendered write", "warm", fixture, { synchronousMs: metric(keyWriteSamples), ...emptyVisualMetrics, outputBytes: metric(keyWriteBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true }),
    scenario("ansi.viewport.frame-construction.100x30", "ANSI frame construction at a 100x30 viewport", "warm", fixture, { synchronousMs: metric(frameSamples), ...emptyVisualMetrics, outputBytes: metric(frameBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true, viewport: "100x30", writeScheduling: "synchronous sink; asynchronous scheduling is not observable" }),
    scenario("ansi.viewport.key-to-write.100x30", "ANSI key transaction through rendered write at a 100x30 viewport", "warm", fixture, { synchronousMs: metric(keyWriteSamples), ...emptyVisualMetrics, outputBytes: metric(keyWriteBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true, viewport: "100x30", writeScheduling: "synchronous sink; asynchronous scheduling is not observable" }),
    ...[...viewport.values()].flatMap((entry) => [
      scenario(`ansi.viewport.frame-construction.${entry.cols}x${entry.rows}`, `ANSI frame construction at a ${entry.cols}x${entry.rows} viewport`, "warm", fixture, { synchronousMs: metric(entry.frame), ...emptyVisualMetrics, outputBytes: metric(entry.frameBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true, viewport: `${entry.cols}x${entry.rows}`, writeScheduling: "synchronous sink; asynchronous scheduling is not observable" }),
      scenario(`ansi.viewport.key-to-write.${entry.cols}x${entry.rows}`, `ANSI key transaction through rendered write at a ${entry.cols}x${entry.rows} viewport`, "warm", fixture, { synchronousMs: metric(entry.key), ...emptyVisualMetrics, outputBytes: metric(entry.keyBytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null }, { ansiWriteSink: true, viewport: `${entry.cols}x${entry.rows}`, writeScheduling: "synchronous sink; asynchronous scheduling is not observable" })
    ]),
    ...[...acceptedViewport.values()].map((entry) => scenario(
      `ansi.viewport.render-to-accepted-write.${entry.cols}x${entry.rows}`,
      `ANSI explicit render request through asynchronous writer acceptance at ${entry.cols}x${entry.rows}`,
      "warm",
      fixture,
      { synchronousMs: null, ...emptyVisualMetrics, acceptedWriteMs: metric(entry.elapsed), outputBytes: metric(entry.bytes, "bytes"), heapBytes: null, rssBytes: null, workerMessageBytes: null },
      { ansiWriteSink: true, viewport: `${entry.cols}x${entry.rows}`, asynchronousWriteAcceptance: "setImmediate callback and resolved writer promise", completionBoundary: "mirror.whenIdle after accepted write", physicalTerminalPaint: false }
    )),
    scenario("memory.sustained-edit-history", "sustained edit session and bounded structurally shared history", "warm", fixture, { synchronousMs: metric(historySamples), ...emptyVisualMetrics, outputBytes: null, heapBytes: metric(heapSamples, "bytes"), rssBytes: metric(rssSamples, "bytes"), workerMessageBytes: null, retainedBytes: metric(historyRetainedBytes, "bytes"), retainedEntries: metric(historyEntries, "entries") }, { processMemory: true, deterministicRetentionAccounting: true, maxEntries: 200, maxRetainedBytes: 8 * 1024 * 1024 }),
    scenario("document.single-character-edit", "piece-table single-character edit with deterministic work proof", "warm", fixture, { synchronousMs: metric(documentEditSamples), ...emptyVisualMetrics, outputBytes: null, heapBytes: null, rssBytes: null, workerMessageBytes: null, indexedBytes: metric(documentEditIndexedBytes, "bytes"), scannedCodeUnits: metric(documentEditScannedCodeUnits, "code-units"), touchedPieces: metric(documentEditTouchedPieces, "pieces"), metadataBytes: metric(documentEditMetadataBytes, "bytes"), pieceCount: metric(documentEditPieceCount, "pieces") }, { documentStorageStats: true, lazyText: true, structurallyShared: true }),
    scenario("document.storage-candidate-evaluation", "steady-state one-character edit candidate evaluation", "warm", fixture, { synchronousMs: metric(documentEditSamples), ...emptyVisualMetrics, outputBytes: null, heapBytes: null, rssBytes: null, workerMessageBytes: null, pieceTableMs: metric(documentEditSamples), incrementallyIndexedStringMs: metric(indexedStringEditSamples), ropeMs: metric(ropeEditSamples), incrementallyIndexedStringRetainedBytes: metric(indexedStringRetainedBytes, "bytes"), incrementallyIndexedStringShiftedStarts: metric(indexedStringShiftedStarts, "line-starts"), ropeCreatedNodes: metric(ropeCreatedNodes, "nodes"), ropeMetadataBytes: metric(ropeMetadataBytes, "bytes") }, { diagnosticCandidates: ["piece-table", "persistent-rope", "incrementally-indexed-string"], ropeNodeByteEstimate: 64 })
  ];
}

function countMessageBytes(hostFactory) {
  let bytes = 0;
  const createWorker = () => {
    const host = hostFactory();
    const messageListeners = new Map();
    return {
      addEventListener(type, listener) {
        if (type !== "message") {
          host.addEventListener(type, listener);
          return;
        }
        const wrapped = (event) => {
          bytes += Buffer.byteLength(JSON.stringify(event.data));
          listener(event);
        };
        messageListeners.set(listener, wrapped);
        host.addEventListener(type, wrapped);
      },
      removeEventListener(type, listener) {
        const wrapped = type === "message" ? messageListeners.get(listener) ?? listener : listener;
        messageListeners.delete(listener);
        host.removeEventListener(type, wrapped);
      },
      postMessage(message) {
        bytes += Buffer.byteLength(JSON.stringify(message));
        host.postMessage(message);
      },
      terminate() {
        messageListeners.clear();
        host.terminate();
      }
    };
  };
  return { createWorker, bytes: () => bytes };
}

export async function runTreeSitterBenchmarks({ samples, lineCount }) {
  const fixture = fixtureName(lineCount);
  const runtime = path.join(ROOT, "node_modules/.pnpm/web-tree-sitter@0.26.8/node_modules/web-tree-sitter/web-tree-sitter.wasm");
  const grammar = path.join(ROOT, "node_modules/.pnpm/tree-sitter-typescript@0.23.2/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm");
  // Absence yields no pretend workload. The result metadata records available suites.
  if (!existsSync(runtime) || !existsSync(grammar)) return [];
  const [treeSitter, node, core] = await Promise.all([
    import(pathToFileURL(path.join(ROOT, "packages/editor-tree-sitter/dist/index.js")).href),
    import(pathToFileURL(path.join(ROOT, "packages/editor-tree-sitter/dist/node.js")).href),
    import(pathToFileURL(path.join(ROOT, "packages/editor-core/dist/index.js")).href)
  ]);
  const query = readFileSync(path.join(ROOT, "apps/playground/src/assets/tree-sitter-typescript-highlights.scm"), "utf8");
  const text = source(lineCount);
  const open = [], incremental = [], highlight = [], stale = [];
  const openBytes = [], incrementalBytes = [], highlightBytes = [], staleBytes = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const meter = countMessageBytes(() => node.createNodeTreeSitterWorkerHost());
    const service = treeSitter.createTreeSitterLanguageServices({ parserWasmUrl: runtime, languageWasmUrl: grammar, query, createWorker: meter.createWorker });
    const doc = core.createTextDocument(text);
    let start = now();
    await service.highlighter.open({ revision: 1, doc });
    open.push(now() - start); openBytes.push(meter.bytes());

    const inserted = "const incremental = true;\n";
    const nextText = `${inserted}${text}`;
    const next = core.createTextDocument(nextText);
    start = now();
    await service.highlighter.update({ revision: 2, doc: next }, [{ from: 0, to: 0, insert: inserted }]);
    incremental.push(now() - start); incrementalBytes.push(meter.bytes() - openBytes.at(-1));

    start = now();
    await service.highlighter.getHighlights({ fromLine: 0, toLine: Math.min(40, lineCount) }, 2);
    highlight.push(now() - start); highlightBytes.push(meter.bytes() - openBytes.at(-1) - incrementalBytes.at(-1));

    // Revision 1 is deliberately stale after the revision-2 update. The worker returns an empty result.
    start = now();
    const staleResult = await service.highlighter.getHighlights({ fromLine: 0, toLine: 1 }, 1);
    if (staleResult.length !== 0) throw new Error("Tree-sitter stale revision unexpectedly produced highlights");
    stale.push(now() - start); staleBytes.push(meter.bytes() - openBytes.at(-1) - incrementalBytes.at(-1) - highlightBytes.at(-1));
    service.highlighter.destroy();
  }
  const common = { ...emptyVisualMetrics, outputBytes: null, heapBytes: null, rssBytes: null };
  const capability = { workerMessageBytes: true, staleRequestVerified: true };
  return [
    scenario("treesitter.open", "Tree-sitter open", "cold", fixture, { synchronousMs: metric(open), ...common, workerMessageBytes: metric(openBytes, "bytes") }, capability),
    scenario("treesitter.incremental-update", "Tree-sitter incremental update", "warm", fixture, { synchronousMs: metric(incremental), ...common, workerMessageBytes: metric(incrementalBytes, "bytes") }, capability),
    scenario("treesitter.highlight", "Tree-sitter highlight", "warm", fixture, { synchronousMs: metric(highlight), ...common, workerMessageBytes: metric(highlightBytes, "bytes") }, capability),
    scenario("treesitter.stale-request", "Tree-sitter stale request", "warm", fixture, { synchronousMs: metric(stale), ...common, workerMessageBytes: metric(staleBytes, "bytes") }, capability)
  ];
}

function shellQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }

function capture(command, args, { timeoutMs = 30_000, cwd = ROOT } = {}) {
  return withTimeout(new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => resolve(null));
    child.once("exit", (code) => resolve(code === 0 ? { stdout, stderr } : null));
  }), timeoutMs, `${command} ${args[0] ?? ""}`).catch(() => null);
}

function waitForTerminalEvent(child, state, boundary, timeoutMs = 45_000) {
  return withTimeout(new Promise((resolve, reject) => {
    const check = () => {
      const expression = /\x1b\]wx-benchmark;[a-z-]+;\d+;\d+\x07/g;
      let match;
      while ((match = expression.exec(state.output))) {
        if (match.index < state.consumed) continue;
        state.consumed = expression.lastIndex;
        try {
          const event = parseDenoTerminalEvent(match[0]);
          if (event.boundary === boundary) return resolve({ ...event, outputBytes: Buffer.byteLength(state.output.slice(state.start, match.index)) });
        } catch (error) { return reject(error); }
      }
    };
    const onData = () => check();
    child.stdout.on("data", onData);
    check();
  }), timeoutMs, `Deno terminal ${boundary} boundary`);
}

async function startDenoTerminal() {
  const cli = path.join(ROOT, "packages/editor-view-ansi/src/deno-cli.ts");
  const tempDir = await mkdtemp(path.join(tmpdir(), "wx-deno-benchmark-"));
  const pidPath = path.join(tempDir, "wx.pid");
  // Deno must be a background child attached back to script's slave PTY. This
  // gives the sampler a concrete product PID to terminate, avoiding signals to
  // GNU script (and, on some shells, its parent process group).
  const command = [
    "stty cols 100 rows 30",
    `${shellQuote("deno")} run --conditions development --quiet --allow-read --allow-write --allow-run=git ${shellQuote(cli)} --benchmark-events < /dev/tty > /dev/tty 2>&1 &`,
    "wx_pid=$!",
    `echo $wx_pid > ${shellQuote(pidPath)}`,
    "wait $wx_pid"
  ].join("; ");
  const child = spawn("script", ["-qfec", command, "/dev/null"], { cwd: ROOT, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const state = { output: "", start: 0, consumed: 0, tempDir, pid: null };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { state.output += chunk; });
  const startup = now();
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && state.pid === null) {
      try { state.pid = Number((await readFile(pidPath, "utf8")).trim()) || null; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    if (state.pid === null) throw new Error("Deno terminal PID was not recorded by GNU script");
    const mounted = await waitForTerminalEvent(child, state, "mounted");
    return { child, state, startup, mounted };
  } catch (error) {
    if (state.pid !== null) try { process.kill(state.pid, "SIGTERM"); } catch { /* process already exited */ }
    try { child.kill("SIGTERM"); } catch { /* process already exited */ }
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function stopDenoTerminal({ child, state }) {
  if (child.exitCode !== null) return;
  if (state.pid !== null) try { process.kill(state.pid, "SIGTERM"); } catch { /* process already exited */ }
  await withTimeout(new Promise((resolve) => child.once("exit", resolve)), 3_000, "Deno terminal shutdown").catch(() => { try { child.kill("SIGTERM"); } catch {} });
  await rm(state.tempDir, { recursive: true, force: true });
}

/** Uses GNU script's slave PTY and explicit terminal state/output markers; unavailable tools omit this suite. */
export async function runDenoBenchmarks({ samples, lineCount }) {
  // Verify availability once. Missing Deno, GNU script, or a PTY is an explicit omission,
  // never a synthetic zero-valued benchmark row.
  if ((await capture("deno", ["--version"], { timeoutMs: 5_000 })) === null) return [];
  const terminalReport = await capture("deno", ["run", "--conditions", "development", "--quiet", "--allow-read", "--allow-write", "--allow-run", "packages/editor-view-ansi/scripts/deno-terminal-benchmark.ts", String(samples), String(lineCount)], { timeoutMs: Math.max(60_000, samples * 50_000) });
  let terminal = null;
  try {
    terminal = JSON.parse(terminalReport?.stdout ?? "");
    for (const key of ["coldMs", "warmMs", "coldBytes", "warmBytes", "coldHeap", "coldRss", "warmHeap", "warmRss"]) {
      if (!Array.isArray(terminal[key]) || terminal[key].length !== samples || terminal[key].some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`Invalid Deno terminal benchmark ${key}`);
    }
  } catch { terminal = null; }
  const grammar = await capture("deno", ["run", "--conditions", "development", "--quiet", "--allow-read", "packages/editor-view-ansi/scripts/deno-tree-sitter-benchmark.ts", String(samples), String(lineCount)], { timeoutMs: Math.max(30_000, samples * 5_000) });
  let grammarResult = null;
  if (grammar) { try { grammarResult = parseDenoBenchmarkReport(grammar.stdout, samples); } catch { grammarResult = null; } }
  const fixture = fixtureName(lineCount);
  const capabilities = { denoTerminal: terminal !== null, terminalEntrypoint: true, terminalExercised: terminal !== null, ...(terminal ? { pty: "GNU script slave PTY", firstFrameBoundary: "terminal.whenIdle after mount", keyWriteBoundary: "terminal.whenIdle after input", processMemory: "Deno.memoryUsage at boundary" } : { terminalEntrypointReason: "GNU script/stty/PTY sampler unavailable or failed" }), grammarInitialized: grammarResult !== null };
  const results = terminal ? [
    scenario("deno.terminal.cold-first-frame", "Deno product terminal process start through completed first frame", "cold", fixture, { synchronousMs: metric(terminal.coldMs), ...emptyVisualMetrics, outputBytes: metric(terminal.coldBytes, "bytes"), heapBytes: metric(terminal.coldHeap, "bytes"), rssBytes: metric(terminal.coldRss, "bytes"), workerMessageBytes: null }, capabilities),
    scenario("deno.terminal.warm-key-to-write", "Deno terminal printable key through next completed write", "warm", fixture, { synchronousMs: metric(terminal.warmMs), ...emptyVisualMetrics, outputBytes: metric(terminal.warmBytes, "bytes"), heapBytes: metric(terminal.warmHeap, "bytes"), rssBytes: metric(terminal.warmRss, "bytes"), workerMessageBytes: null }, capabilities)
  ] : [];
  if (grammarResult) results.push(scenario("deno.treesitter.initialize-open", "Deno Tree-sitter adapter readiness and TypeScript document open", "cold", fixture, { synchronousMs: metric(grammarResult.openMs), ...emptyVisualMetrics, outputBytes: null, heapBytes: null, rssBytes: null, workerMessageBytes: null, grammarReadyMs: metric(grammarResult.readyMs) }, { ...capabilities, grammarInitialized: true, grammarReadinessBoundary: "services.lifecycle.whenReady", grammarOpenBoundary: "highlighter.open" }));
  return results;
}
