import { latencyStats } from './loadTest';

/**
 * Performance regressions between two runs of the same collection: per
 * request, compare p50/p95 latency and error rate, and flag the ones that got
 * meaningfully worse. Works on functional runs (the Runner, `kapi run`), load
 * tests (`kapi load`) and anything else that can be reduced to samples.
 *
 * "Meaningfully" is deliberately conservative — a regression needs a big
 * enough relative change *and* a big enough absolute one *and* enough samples
 * on both sides, so a 3ms → 5ms blip on one sample never cries wolf.
 */

export interface RunSample {
  /** Identifies a request across runs: method + folder path + name. */
  key: string;
  label: string;
  durationMs: number;
  /** false for a failed test, an HTTP error status the run treated as failure, or a transport error. */
  ok: boolean;
}

export interface RequestStats {
  key: string;
  label: string;
  count: number;
  p50: number;
  p95: number;
  errorRate: number;
}

/** A run reduced to what a comparison needs — small enough to keep in history or a baseline file. */
export interface RunStats {
  /** `kapi-run-stats/1` so a baseline file can be recognised. */
  format: 'kapi-run-stats/1';
  at: number;
  requests: RequestStats[];
}

export interface RegressionThresholds {
  /** Relative latency increase that counts, e.g. 0.2 for +20%. */
  latencyPct: number;
  /** …and the absolute increase it must also exceed, in ms. */
  latencyMinMs: number;
  /** Error-rate increase that counts, in percentage points (1 = +1pp). */
  errorRatePts: number;
  /** Samples needed on both sides before latency is judged at all. */
  minSamples: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = { latencyPct: 0.2, latencyMinMs: 50, errorRatePts: 1, minSamples: 3 };

export type ChangeKind = 'regressed' | 'improved' | 'unchanged' | 'new' | 'removed' | 'too-few-samples';

export interface RequestChange {
  key: string;
  label: string;
  kind: ChangeKind;
  /** Why it's flagged, in words — shown in the UI and the CLI. */
  reasons: string[];
  before: RequestStats | null;
  after: RequestStats | null;
  p50DeltaPct: number | null;
  p95DeltaPct: number | null;
  errorRateDeltaPts: number | null;
}

export interface RunComparison {
  changes: RequestChange[];
  regressed: number;
  improved: number;
}

export function sampleKey(method: string, path: string[], name: string): string {
  return `${method.toUpperCase()} ${[...path, name].join(' / ')}`;
}

export function statsFromSamples(samples: RunSample[], at = Date.now()): RunStats {
  const groups = new Map<string, RunSample[]>();
  for (const s of samples) {
    const list = groups.get(s.key) ?? [];
    list.push(s);
    groups.set(s.key, list);
  }
  const requests = [...groups.values()].map((list) => {
    const l = latencyStats(list.map((s) => s.durationMs));
    return {
      key: list[0].key,
      label: list[0].label,
      count: list.length,
      p50: l.p50,
      p95: l.p95,
      errorRate: list.filter((s) => !s.ok).length / list.length,
    };
  });
  return { format: 'kapi-run-stats/1', at, requests };
}

const pct = (before: number, after: number) => (before > 0 ? (after - before) / before : after > 0 ? Infinity : 0);

export function compareRuns(baseline: RunStats, current: RunStats, thresholds: RegressionThresholds = DEFAULT_THRESHOLDS): RunComparison {
  const before = new Map(baseline.requests.map((r) => [r.key, r]));
  const after = new Map(current.requests.map((r) => [r.key, r]));
  const keys = [...new Set([...current.requests.map((r) => r.key), ...baseline.requests.map((r) => r.key)])];
  const changes: RequestChange[] = keys.map((key) => {
    const b = before.get(key) ?? null;
    const a = after.get(key) ?? null;
    const base = { key, label: (a ?? b)!.label, before: b, after: a };
    if (!b) return { ...base, kind: 'new', reasons: [], p50DeltaPct: null, p95DeltaPct: null, errorRateDeltaPts: null };
    if (!a) return { ...base, kind: 'removed', reasons: [], p50DeltaPct: null, p95DeltaPct: null, errorRateDeltaPts: null };

    const p50DeltaPct = pct(b.p50, a.p50);
    const p95DeltaPct = pct(b.p95, a.p95);
    const errorRateDeltaPts = (a.errorRate - b.errorRate) * 100;
    const worse: string[] = [];
    const better: string[] = [];

    if (errorRateDeltaPts >= thresholds.errorRatePts) worse.push(`errors ${fmtPts(b.errorRate)} → ${fmtPts(a.errorRate)}`);
    else if (errorRateDeltaPts <= -thresholds.errorRatePts) better.push(`errors ${fmtPts(b.errorRate)} → ${fmtPts(a.errorRate)}`);

    const enough = a.count >= thresholds.minSamples && b.count >= thresholds.minSamples;
    if (enough) {
      for (const [name, bv, av, d] of [['p50', b.p50, a.p50, p50DeltaPct], ['p95', b.p95, a.p95, p95DeltaPct]] as const) {
        if (d >= thresholds.latencyPct && av - bv >= thresholds.latencyMinMs) worse.push(`${name} ${fmtMs(bv)} → ${fmtMs(av)} (${fmtPct(d)})`);
        else if (d <= -thresholds.latencyPct && bv - av >= thresholds.latencyMinMs) better.push(`${name} ${fmtMs(bv)} → ${fmtMs(av)} (${fmtPct(d)})`);
      }
    }

    const kind: ChangeKind = worse.length ? 'regressed' : better.length ? 'improved' : enough ? 'unchanged' : 'too-few-samples';
    return { ...base, kind, reasons: worse.length ? worse : better, p50DeltaPct, p95DeltaPct, errorRateDeltaPts };
  });
  const order: Record<ChangeKind, number> = { regressed: 0, new: 1, removed: 2, improved: 3, unchanged: 4, 'too-few-samples': 5 };
  changes.sort((x, y) => order[x.kind] - order[y.kind] || x.label.localeCompare(y.label));
  return { changes, regressed: changes.filter((c) => c.kind === 'regressed').length, improved: changes.filter((c) => c.kind === 'improved').length };
}

export function fmtMs(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

export function fmtPct(d: number): string {
  if (!Number.isFinite(d)) return 'new';
  const v = Math.round(d * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function fmtPts(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Reads a baseline from any of the JSON shapes kapi writes: a `RunStats`
 * file (`--save-baseline`), `kapi run --json` output, or `kapi load --json`
 * output. Returns null for anything else.
 */
export function statsFromBaselineFile(data: unknown): RunStats | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.format === 'kapi-run-stats/1' && Array.isArray(d.requests)) return d as unknown as RunStats;
  if (Array.isArray(data)) {
    // kapi run --json: HeadlessResult[]
    const rows = data as { method?: string; path?: string[]; name?: string; durationMs?: number; status?: string }[];
    if (rows.every((r) => typeof r?.durationMs === 'number' && typeof r?.name === 'string')) {
      return statsFromSamples(
        rows.map((r) => ({
          key: sampleKey(r.method ?? 'GET', r.path ?? [], r.name!),
          label: sampleKey(r.method ?? 'GET', r.path ?? [], r.name!),
          durationMs: r.durationMs!,
          ok: r.status === 'passed',
        })),
      );
    }
    return null;
  }
  if (Array.isArray(d.byRequest)) {
    // kapi load --json: a LoadSummary
    return statsFromLoadSummary(d.byRequest as Parameters<typeof statsFromLoadSummary>[0], 0);
  }
  return null;
}

/** Samples from saved runs (Runner, monitors) — each request result is one sample. */
export function samplesFromHistory(entries: { results: { method: string; path: string[]; name: string; durationMs: number; status: string }[] }[]): RunSample[] {
  return entries.flatMap((entry) =>
    entry.results.map((r) => {
      const key = sampleKey(r.method, r.path, r.name);
      return { key, label: key, durationMs: r.durationMs, ok: r.status === 'passed' };
    }),
  );
}

/**
 * For a series of single-iteration runs (a monitor): the most recent `recent`
 * runs against the `window` runs before them, so one slow sample never
 * decides anything. Null until there's enough history on both sides.
 * `entries` must be newest first.
 */
export function compareRecentToHistory<T extends Parameters<typeof samplesFromHistory>[0][number]>(
  entries: T[],
  recent = 3,
  window = 10,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RunComparison | null {
  const latest = entries.slice(0, recent);
  const before = entries.slice(recent, recent + window);
  if (latest.length < recent || before.length < recent) return null;
  return compareRuns(statsFromSamples(samplesFromHistory(before)), statsFromSamples(samplesFromHistory(latest)), thresholds);
}

/** A load test summary's per-request rows as comparable stats. */
export function statsFromLoadSummary(byRequest: { name: string; method: string; count: number; p50: number; p95: number; errorRate: number }[], at = Date.now()): RunStats {
  return {
    format: 'kapi-run-stats/1',
    at,
    requests: byRequest.map((r) => {
      const key = `${r.method.toUpperCase()} ${r.name}`;
      return { key, label: key, count: r.count, p50: r.p50, p95: r.p95, errorRate: r.errorRate };
    }),
  };
}
