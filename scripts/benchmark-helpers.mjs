/** Shared, dependency-free helpers for reproducible editor benchmark output. */
export const BENCHMARK_FORMAT_VERSION = 1;

export function percentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function aggregateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new TypeError("Benchmark samples must be finite, non-negative numbers");
  }
  return { count: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: samples.length >= 30 ? percentile(samples, 0.99) : null };
}

export function withTimeout(promise, timeoutMs, label = "benchmark operation") {
  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

/** Freezes a latency sample at its observable boundary, before teardown work begins. */
export function boundaryElapsedMs(startedAt, boundaryAt) {
  const elapsed = boundaryAt - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new TypeError("Invalid benchmark boundary timestamps");
  return elapsed;
}

/** Parses the explicit OSC boundary emitted by the opt-in Deno terminal benchmark hook. */
export function parseDenoTerminalEvent(text) {
  const match = /^\x1b\]wx-benchmark;([a-z-]+);(\d+);(\d+)\x07$/.exec(text);
  if (!match) throw new TypeError("Malformed Deno terminal benchmark event");
  const [, boundary, heapBytes, rssBytes] = match;
  return { boundary, heapBytes: Number(heapBytes), rssBytes: Number(rssBytes) };
}

/** Validates a line-oriented Deno benchmark report before it becomes benchmark evidence. */
export function parseDenoBenchmarkReport(text, expectedSamples) {
  let value;
  try { value = JSON.parse(text.trim()); }
  catch { throw new TypeError("Malformed Deno benchmark report"); }
  if (!value || !Array.isArray(value.readyMs) || !Array.isArray(value.openMs) ||
      value.readyMs.length !== expectedSamples || value.openMs.length !== expectedSamples) {
    throw new TypeError("Invalid Deno benchmark report sample count");
  }
  aggregateSamples(value.readyMs);
  aggregateSamples(value.openMs);
  return value;
}

export function validateResult(result) {
  if (!result || result.formatVersion !== BENCHMARK_FORMAT_VERSION || !Array.isArray(result.scenarios)) {
    throw new TypeError("Invalid benchmark result: missing formatVersion or scenarios");
  }
  const ids = new Set();
  for (const scenario of result.scenarios) {
    if (!scenario.id || !scenario.workload || !["cold", "warm"].includes(scenario.state) || !scenario.metrics) {
      throw new TypeError(`Invalid benchmark scenario: ${scenario?.id ?? "unknown"}`);
    }
    if (ids.has(scenario.id)) throw new TypeError(`Duplicate benchmark scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    for (const metric of Object.values(scenario.metrics)) {
      if (metric === null) continue;
      if (!Array.isArray(metric.samples) || metric.samples.length === 0) throw new TypeError(`Invalid metric samples in ${scenario.id}`);
      aggregateSamples(metric.samples);
    }
  }
  return result;
}

// A regression must exceed both a practical threshold and a robust noise band.
export function compareMetric(baseline, candidate, { practicalPercent = 10, minimumMs = 1 } = {}) {
  const base = aggregateSamples(baseline);
  const next = aggregateSamples(candidate);
  if (base.count < 30 || next.count < 30) return { gate: false, reason: "insufficient samples" };
  const delta = next.p50 - base.p50;
  const percent = (delta / Math.max(base.p50, 0.001)) * 100;
  const baselineIqr = percentile(baseline, 0.75) - percentile(baseline, 0.25);
  return { gate: delta >= Math.max(minimumMs, baselineIqr * 1.5) && percent >= practicalPercent, delta, percent, baseline: base, candidate: next };
}
