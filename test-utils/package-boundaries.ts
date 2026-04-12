import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CROSS_PACKAGE_SRC_IMPORT_PATTERN = /from\s+["'](?:\.\.\/)+[^"']+\/src(?:\/[^"']+)?["']/;

export function collectCrossPackageSrcLeaks(relativeDir: string): string[] {
  const root = resolve(process.cwd(), relativeDir);
  const queue = [root];
  const leaks: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop()!;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }

      if (!entry.isFile() || !absolute.endsWith(".ts") || absolute.endsWith(".test.ts")) {
        continue;
      }

      const source = readFileSync(absolute, "utf8");
      if (CROSS_PACKAGE_SRC_IMPORT_PATTERN.test(source)) {
        leaks.push(absolute);
      }
    }
  }

  return leaks.sort();
}
