import { runHeadless, type HeadlessOptions, type HeadlessResult } from '@/cli/headlessRunner';

/**
 * Load testing: N virtual users each running the collection (or folder)
 * sequence in a loop — scripts, variable hand-offs and all — concurrently,
 * for a fixed duration or number of iterations. Each virtual user keeps its
 * own copy of the variables, so a login in one user's iteration feeds only
 * that user's later requests, and nothing is written back to the workspace.
 *
 * Shared by the app (Runner → Load test) and the CLI (`kapi load`).
 */

export interface LoadTestConfig {
  virtualUsers: number;
  /** Stop after this long. Either this or `iterationsPerUser` (or both — whichever comes first). */
  durationMs?: number;
  iterationsPerUser?: number;
  /** Virtual users start evenly spread over this window instead of all at once. */
  rampUpMs: number;
  /** Pause after each request, per virtual user. */
  thinkTimeMs: number;
  runScripts: boolean;
}

export interface LoadSample {
  /** Milliseconds since the test started, when the response (or error) arrived. */
  at: number;
  vu: number;
  name: string;
  method: string;
  status: HeadlessResult['status'];
  httpStatus: number | null;
  durationMs: number;
}

export interface LoadTestRun {
  /** Resolves when every virtual user has finished. */
  done: Promise<void>;
  stop: () => void;
}

export type LoadBase = Omit<HeadlessOptions, 'iterations' | 'delayMs' | 'onResult' | 'shouldContinue' | 'runScripts' | 'dataRows'> & {
  dataRows?: Record<string, string>[];
  /** A send function per virtual user — e.g. each with its own cookie jar, like separate browsers. */
  sendFnFor?: (vu: number) => HeadlessOptions['sendFn'];
};

export function startLoadTest(base: LoadBase, config: LoadTestConfig, onSample: (sample: LoadSample) => void): LoadTestRun {
  const users = Math.max(1, Math.floor(config.virtualUsers));
  const started = Date.now();
  const deadline = config.durationMs ? started + config.durationMs : Infinity;
  let stopped = false;
  const shouldContinue = () => !stopped && Date.now() < deadline;

  // Ramp-up waits end early when the test is stopped.
  const waiters = new Set<() => void>();
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        waiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      waiters.add(wake);
    });

  const vus = Array.from({ length: users }, async (_, vu) => {
    const offset = users > 1 ? Math.round((config.rampUpMs * vu) / users) : 0;
    if (offset) await sleep(offset);
    if (!shouldContinue()) return;
    const { sendFnFor, ...shared } = base;
    await runHeadless({
      ...shared,
      sendFn: sendFnFor ? sendFnFor(vu) : shared.sendFn,
      dataRows: base.dataRows ?? [],
      iterations: config.iterationsPerUser ?? Infinity,
      delayMs: config.thinkTimeMs,
      runScripts: config.runScripts,
      shouldContinue,
      onResult: (r) =>
        onSample({
          at: Date.now() - started,
          vu,
          name: [...r.path, r.name].join(' / '),
          method: r.method,
          status: r.status,
          httpStatus: r.httpStatus,
          durationMs: r.durationMs,
        }),
    });
  });

  return {
    done: Promise.all(vus).then(() => undefined),
    stop: () => {
      stopped = true;
      for (const wake of [...waiters]) wake();
    },
  };
}

/* ------------------------------------------------------------- summary */

export interface LatencyStats {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LoadSummary {
  elapsedMs: number;
  requests: number;
  /** Requests per second over the elapsed time. */
  throughput: number;
  failed: number;
  errored: number;
  /** (failed + errored) / requests, 0–1. */
  errorRate: number;
  latency: LatencyStats;
  byRequest: ({ name: string; method: string; errorRate: number } & LatencyStats)[];
  statusCodes: Record<string, number>;
  /** One bucket per second: requests completed, errors, mean latency. */
  timeline: { second: number; requests: number; errors: number; meanMs: number }[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  // Nearest-rank, the definition load tools (k6, JMeter) report.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function latencyStats(durations: number[]): LatencyStats {
  if (!durations.length) return { count: 0, min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, d) => sum + d, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    mean,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

export function summarize(samples: LoadSample[], elapsedMs: number): LoadSummary {
  const failed = samples.filter((s) => s.status === 'failed').length;
  const errored = samples.filter((s) => s.status === 'error').length;

  const groups = new Map<string, LoadSample[]>();
  for (const s of samples) {
    const key = `${s.method} ${s.name}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  const byRequest = [...groups.values()].map((list) => ({
    name: list[0].name,
    method: list[0].method,
    errorRate: list.filter((s) => s.status !== 'passed').length / list.length,
    ...latencyStats(list.map((s) => s.durationMs)),
  }));

  const statusCodes: Record<string, number> = {};
  for (const s of samples) {
    const key = s.httpStatus === null ? 'error' : String(s.httpStatus);
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;
  }

  const seconds = Math.max(1, Math.ceil(elapsedMs / 1000));
  const timeline = Array.from({ length: seconds }, (_, second) => ({ second, requests: 0, errors: 0, meanMs: 0 }));
  for (const s of samples) {
    const bucket = timeline[Math.min(seconds - 1, Math.floor(s.at / 1000))];
    bucket.meanMs += s.durationMs;
    bucket.requests++;
    if (s.status !== 'passed') bucket.errors++;
  }
  for (const bucket of timeline) bucket.meanMs = bucket.requests ? bucket.meanMs / bucket.requests : 0;

  return {
    elapsedMs,
    requests: samples.length,
    throughput: samples.length / Math.max(0.001, elapsedMs / 1000),
    failed,
    errored,
    errorRate: samples.length ? (failed + errored) / samples.length : 0,
    latency: latencyStats(samples.map((s) => s.durationMs)),
    byRequest,
    statusCodes,
    timeline,
  };
}

/* ---------------------------------------------------------- thresholds */

export interface ThresholdResult {
  expression: string;
  passed: boolean;
  actual: number;
}

const METRICS: Record<string, (s: LoadSummary) => number> = {
  p50: (s) => s.latency.p50,
  p90: (s) => s.latency.p90,
  p95: (s) => s.latency.p95,
  p99: (s) => s.latency.p99,
  max: (s) => s.latency.max,
  mean: (s) => s.latency.mean,
  avg: (s) => s.latency.mean,
  errors: (s) => s.errorRate * 100,
  'error-rate': (s) => s.errorRate * 100,
  rps: (s) => s.throughput,
};

/**
 * Pass/fail checks for CI, e.g. `p95<500`, `errors<1`, `rps>=50`. Latency is
 * in ms, error rate in percent (a trailing `%` or `ms` is accepted).
 */
export function checkThreshold(expression: string, summary: LoadSummary): ThresholdResult {
  const match = /^\s*([a-z0-9-]+)\s*(<=|>=|<|>|==)\s*([0-9.]+)\s*(ms|%)?\s*$/i.exec(expression);
  if (!match || !METRICS[match[1].toLowerCase()]) {
    throw new Error(`Can't read threshold "${expression}" — use e.g. p95<500, errors<1, rps>=50 (metrics: ${Object.keys(METRICS).join(', ')})`);
  }
  const actual = METRICS[match[1].toLowerCase()](summary);
  const limit = Number(match[3]);
  const op = match[2];
  const passed = op === '<' ? actual < limit : op === '<=' ? actual <= limit : op === '>' ? actual > limit : op === '>=' ? actual >= limit : actual === limit;
  return { expression: expression.trim(), passed, actual };
}
