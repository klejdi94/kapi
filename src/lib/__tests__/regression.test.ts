import { describe, expect, it } from 'vitest';
import { compareRuns, sampleKey, statsFromBaselineFile, statsFromSamples, type RunSample } from '../regression';

const samples = (key: string, durations: number[], failures = 0): RunSample[] =>
  durations.map((durationMs, i) => ({ key, label: key, durationMs, ok: i >= failures }));

describe('performance regressions', () => {
  it('flags a big enough slowdown, and ignores small or noisy ones', () => {
    const before = statsFromSamples([...samples('GET /a', [100, 100, 100, 100]), ...samples('GET /b', [10, 10, 10, 10]), ...samples('GET /c', [100, 100])]);
    const after = statsFromSamples([...samples('GET /a', [200, 210, 190, 220]), ...samples('GET /b', [20, 20, 20, 20]), ...samples('GET /c', [900, 900])]);
    const result = compareRuns(before, after);
    const byKey = Object.fromEntries(result.changes.map((c) => [c.key, c]));
    expect(byKey['GET /a'].kind).toBe('regressed');
    expect(byKey['GET /a'].reasons[0]).toMatch(/^p50 100ms → 2\d\dms \(\+\d+%\)$/);
    expect(byKey['GET /b'].kind).toBe('unchanged'); // +100%, but only +10ms
    expect(byKey['GET /c'].kind).toBe('too-few-samples'); // 2 samples each side
    expect(result.regressed).toBe(1);
    expect(result.changes[0].key).toBe('GET /a'); // regressions sort first
  });

  it('flags rising errors even with few samples, and notices new and removed requests', () => {
    const before = statsFromSamples([...samples('GET /a', [10]), ...samples('GET /gone', [10])]);
    const after = statsFromSamples([...samples('GET /a', [10], 1), ...samples('GET /new', [10])]);
    const kinds = Object.fromEntries(compareRuns(before, after).changes.map((c) => [c.key, c.kind]));
    expect(kinds).toEqual({ 'GET /a': 'regressed', 'GET /new': 'new', 'GET /gone': 'removed' });
  });

  it('reports improvements', () => {
    const before = statsFromSamples(samples('GET /a', [400, 400, 400]));
    const after = statsFromSamples(samples('GET /a', [100, 100, 100]));
    const [change] = compareRuns(before, after).changes;
    expect(change.kind).toBe('improved');
    expect(change.reasons[0]).toBe('p50 400ms → 100ms (-75%)');
  });

  it('reads baselines from every JSON shape kapi writes', () => {
    const runJson = [
      { method: 'GET', path: ['users'], name: 'list', durationMs: 120, status: 'passed' },
      { method: 'GET', path: ['users'], name: 'list', durationMs: 140, status: 'failed' },
    ];
    const fromRun = statsFromBaselineFile(runJson)!;
    expect(fromRun.requests).toEqual([{ key: sampleKey('GET', ['users'], 'list'), label: 'GET users / list', count: 2, p50: 120, p95: 140, errorRate: 0.5 }]);

    const loadJson = { requests: 10, byRequest: [{ name: 'users / list', method: 'get', count: 10, p50: 50, p95: 90, errorRate: 0, min: 1 }] };
    expect(statsFromBaselineFile(loadJson)!.requests[0]).toMatchObject({ key: 'GET users / list', p95: 90 });

    const saved = statsFromSamples(samples('GET /a', [1]));
    expect(statsFromBaselineFile(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(statsFromBaselineFile({ nope: true })).toBeNull();
  });
});

describe('monitor-style comparisons', () => {
  const run = (ms: number, status = 'passed') => ({ results: [{ method: 'GET', path: [], name: 'health', durationMs: ms, status }] });

  it('needs enough history, then compares the latest runs to the ones before', async () => {
    const { compareRecentToHistory } = await import('../regression');
    expect(compareRecentToHistory([run(10), run(10), run(10), run(10)])).toBeNull();
    const steady = [run(100), run(100), run(100), ...Array.from({ length: 10 }, () => run(100))];
    expect(compareRecentToHistory(steady)!.regressed).toBe(0);
    const slower = [run(400), run(380), run(420), ...Array.from({ length: 10 }, () => run(100))]; // newest first
    const result = compareRecentToHistory(slower)!;
    expect(result.regressed).toBe(1);
    expect(result.changes[0].reasons[0]).toMatch(/^p50 100ms → 400ms/);
  });
});
