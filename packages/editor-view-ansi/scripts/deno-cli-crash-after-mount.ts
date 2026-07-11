/// <reference lib="deno.ns" />

import { runDenoCli } from "../src/deno-cli.ts";

try {
  await runDenoCli(Deno.args, { crashAfterMount: true });
} catch (error) {
  Deno.stderr.writeSync(new TextEncoder().encode(`wx test crash: ${error instanceof Error ? error.message : String(error)}\n`));
  Deno.exit(1);
}
