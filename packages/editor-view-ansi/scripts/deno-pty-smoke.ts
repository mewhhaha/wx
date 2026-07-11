/// <reference lib="deno.ns" />

import { fileURLToPath } from "node:url";
import { join } from "node:path";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliPath = join(repoRoot, "packages/editor-view-ansi/src/deno-cli.ts");
const crashCliPath = join(repoRoot, "packages/editor-view-ansi/scripts/deno-cli-crash-after-mount.ts");

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor<T>(read: () => Promise<T | null>, description: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await delay(25);
  }
  throw new Error(`${description} within 10s`);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

type LifecycleCase = "normal" | "sigint" | "sigterm" | "crash";

async function runCase(kind: LifecycleCase): Promise<{ transcriptBytes: number }> {
  const tempDir = await Deno.makeTempDir({ prefix: `wx-deno-pty-${kind}-` });
  const transcriptPath = join(tempDir, "typescript");
  const pidPath = join(tempDir, "wx.pid");
  const ttyPath = join(tempDir, "wx.tty");
  const filePath = join(tempDir, "note.txt");
  try {
    await Deno.writeTextFile(filePath, "before\n");
    const program = kind === "crash" ? crashCliPath : cliPath;
    const childCommand = [
      "stty cols 80 rows 24",
      `tty > ${shellQuote(ttyPath)}`,
      // Background jobs otherwise receive /dev/null as stdin from sh; bind the
      // child back to script's slave PTY so Deno observes an interactive TTY.
      `${shellQuote(Deno.execPath())} run --conditions development --allow-read --allow-write --allow-run=git ${shellQuote(program)} note.txt < /dev/tty > /dev/tty 2>&1 &`,
      "wx_pid=$!",
      `echo $wx_pid > ${shellQuote(pidPath)}`,
      "wait $wx_pid",
      "wx_status=$?",
      "stty -a",
      "exit $wx_status"
    ].join("; ");
    const child = new Deno.Command("script", {
      args: ["-qfec", childCommand, transcriptPath],
      cwd: tempDir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped"
    }).spawn();
    const input = child.stdin.getWriter();
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let startupOutput = "";
    let markReady: (() => void) | null = null;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const collectStdout = (async () => {
      for await (const chunk of child.stdout) {
        stdoutChunks.push(chunk);
        startupOutput += decoder.decode(chunk, { stream: true });
        if (startupOutput.includes("\u001b[?1049h")) markReady?.();
      }
    })();
    const collectStderr = (async () => {
      for await (const chunk of child.stderr) stderrChunks.push(chunk);
    })();

    await Promise.race([ready, delay(10_000).then(() => { throw new Error(`${kind} PTY terminal did not reach its first frame`); })]);
    const pid = await waitFor(async () => {
      try { return Number((await Deno.readTextFile(pidPath)).trim()) || null; }
      catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
    }, `${kind} PTY child pid was not recorded`);
    const slaveTty = await waitFor(async () => {
      try { const value = (await Deno.readTextFile(ttyPath)).trim(); return value || null; }
      catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
    }, `${kind} PTY slave terminal was not recorded`);

    if (kind === "normal") {
      const resized = await new Deno.Command("stty", { args: ["-F", slaveTty, "cols", "100", "rows", "30"], stdout: "null", stderr: "piped" }).output();
      assert(resized.success, `failed to resize slave PTY: ${decoder.decode(resized.stderr)}`);
      Deno.kill(pid, "SIGWINCH");
      await waitFor(async () => startupOutput.includes("\u001b[30;1H") ? true : null, "resized 100x30 terminal frame was not rendered");
      // Keep Escape in its own PTY read, matching a real interactive key event.
      await input.write(encoder.encode("iX"));
      await delay(75);
      await input.write(encoder.encode("\u001b"));
      await delay(75);
      await input.write(encoder.encode(":w\r:q\r"));
    } else if (kind === "sigint") {
      Deno.kill(pid, "SIGINT");
    } else if (kind === "sigterm") {
      Deno.kill(pid, "SIGTERM");
    }
    await input.close();

    const result = await Promise.race([
      child.status,
      delay(10_000).then(() => {
        try { child.kill("SIGTERM"); } catch { /* already exited */ }
        throw new Error(`${kind} PTY case did not finish within 10s`);
      })
    ]);
    await Promise.all([collectStdout, collectStderr]);
    const stdout = decoder.decode(concatBytes(stdoutChunks));
    const stderr = decoder.decode(concatBytes(stderrChunks));
    const transcript = await Deno.readTextFile(transcriptPath);
    const saved = await Deno.readTextFile(filePath);
    if (kind === "crash") assert(!result.success, `injected crash unexpectedly succeeded: ${stderr || stdout}`);
    else assert(result.success, `${kind} PTY child failed (${result.code}): ${stderr || stdout}`);
    if (kind === "normal") assert(saved === "Xbefore\n", `PTY edit/save mismatch: ${JSON.stringify(saved)}`);
    assert(transcript.includes("\u001b[?1049h"), `${kind}: alternate screen was not entered`);
    assert(transcript.includes("\u001b[?1049l"), `${kind}: alternate screen was not restored`);
    assert(transcript.includes("\u001b[?25h"), `${kind}: cursor visibility was not restored`);
    assert(/(?:^|[;\s])icanon(?:[;\s]|$)/m.test(transcript), `${kind}: canonical input mode was not restored`);
    assert(/(?:^|[;\s])echo(?:[;\s]|$)/m.test(transcript), `${kind}: echo mode was not restored`);
    const orphan = await new Deno.Command("kill", { args: ["-0", String(pid)], stdout: "null", stderr: "null" }).output();
    assert(!orphan.success, `${kind}: wx child ${pid} remained alive after PTY completion`);
    return { transcriptBytes: encoder.encode(transcript).byteLength };
  } finally {
    if (Deno.env.get("WX_KEEP_PTY_ARTIFACTS") !== "1") await Deno.remove(tempDir, { recursive: true });
    else console.error(`PTY artifacts kept at ${tempDir}`);
  }
}

const results = await Promise.all(["normal", "sigint", "sigterm", "crash"].map((kind) => runCase(kind as LifecycleCase)));
console.log(JSON.stringify({
  runtime: Deno.version.deno,
  normalEditSaveQuit: true,
  sigintCleanup: true,
  sigtermCleanup: true,
  recoverableCrashCleanup: true,
  rawModeRestored: true,
  cursorRestored: true,
  alternateScreenRestored: true,
  noOrphanChild: true,
  resize: "slave PTY changed from 80x24 to 100x30 and SIGWINCH produced a 30-row repaint",
  transcriptBytes: results.reduce((sum, result) => sum + result.transcriptBytes, 0)
}));
