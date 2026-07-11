/// <reference lib="deno.ns" />

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { boundaryElapsedMs } from "../../../scripts/benchmark-helpers.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const samples = Number(Deno.args[0]);
const lineCount = Number(Deno.args[1]);
if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(lineCount) || lineCount < 1) throw new Error("Expected positive sample and line counts");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const cli = join(root, "packages/editor-view-ansi/src/deno-cli.ts");
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type TerminalSample = { coldMs: number; warmMs: number; coldBytes: number; warmBytes: number; coldHeap: number; coldRss: number; warmHeap: number; warmRss: number };

async function one(): Promise<TerminalSample> {
  const dir = await Deno.makeTempDir({ prefix: "wx-deno-terminal-benchmark-" });
  const pidPath = join(dir, "wx.pid");
  await Deno.writeTextFile(join(dir, "fixture.ts"), Array.from({ length: lineCount }, (_, index) => `const value${index} = ${index};`).join("\n"));
  const command = ["stty cols 100 rows 30", `${quote(Deno.execPath())} run --conditions development --quiet --allow-read --allow-write --allow-run=git ${quote(cli)} --benchmark-events fixture.ts < /dev/tty > /dev/tty 2>&1 &`, "wx_pid=$!", `echo $wx_pid > ${quote(pidPath)}`, "wait $wx_pid"].join("; ");
  const child = new Deno.Command("script", { args: ["-qfec", command, "/dev/null"], cwd: dir, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
  const start = performance.now(); let output = "", cursor = 0;
  const reader = (async () => { for await (const chunk of child.stdout) output += decoder.decode(chunk, { stream: true }); })();
  const event = async (name: string, from: number) => {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const match = /\x1b\]wx-benchmark;([a-z-]+);(\d+);(\d+)\x07/g;
      let found: RegExpExecArray | null;
      while ((found = match.exec(output))) if (found.index >= cursor && found[1] === name) { cursor = match.lastIndex; return { heap: Number(found[2]), rss: Number(found[3]), bytes: encoder.encode(output.slice(from, found.index)).byteLength }; }
      await delay(5);
    }
    throw new Error(`Timed out waiting for ${name} terminal boundary`);
  };
  try {
    const mounted = await event("mounted", 0);
    const coldMs = performance.now() - start;
    const input = child.stdin.getWriter();
    await input.write(encoder.encode("i")); await event("input", output.length);
    const warmStart = performance.now(), warmFrom = output.length;
    await input.write(encoder.encode("X")); const written = await event("input", warmFrom);
    const warmMs = boundaryElapsedMs(warmStart, performance.now());
    const pid = Number((await Deno.readTextFile(pidPath)).trim()); Deno.kill(pid, "SIGTERM");
    await Promise.race([child.status, delay(5_000).then(() => { try { child.kill("SIGTERM"); } catch {} throw new Error("PTY child did not stop"); })]);
    await input.close();
    await reader;
    const alive = await new Deno.Command("kill", { args: ["-0", String(pid)], stdout: "null", stderr: "null" }).output();
    if (alive.success) throw new Error(`Deno terminal child ${pid} remained alive after sampler shutdown`);
    return { coldMs, warmMs, coldBytes: mounted.bytes, warmBytes: written.bytes, coldHeap: mounted.heap, coldRss: mounted.rss, warmHeap: written.heap, warmRss: written.rss };
  } finally { try { child.kill("SIGTERM"); } catch {} await Deno.remove(dir, { recursive: true }); }
}

const rows: TerminalSample[] = [];
for (let sample = 0; sample < samples; sample += 1) rows.push(await one());
console.log(JSON.stringify(Object.fromEntries(Object.keys(rows[0]!).map((key) => [key, rows.map((row) => row[key as keyof typeof row])]))));
