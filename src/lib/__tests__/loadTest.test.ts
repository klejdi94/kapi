import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkThreshold, latencyStats, startLoadTest, summarize, type LoadSample } from '../loadTest';
import { newCollection, newRequestNode } from '../factory';
import { headlessTargetsFor } from '@/cli/headlessRunner';

let base = '';
let server: http.Server;
let inFlight = 0;
let maxInFlight = 0;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    setTimeout(() => {
      inFlight--;
      res.writeHead(req.url === '/fail' ? 500 : 200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    }, 20);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function collectionWith(paths: string[], testScript = '') {
  const collection = newCollection('load');
  collection.items = paths.map((p) => newRequestNode(p, { url: `${base}${p}`, params: [], testScript }));
  return collection;
}

describe('latency stats', () => {
  it('uses nearest-rank percentiles', () => {
    const stats = latencyStats(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(stats).toMatchObject({ count: 100, min: 1, max: 100, p50: 50, p90: 90, p95: 95, p99: 99, mean: 50.5 });
    expect(latencyStats([])).toMatchObject({ count: 0, p95: 0 });
  });
});

describe('load test', () => {
  it('runs virtual users concurrently for a fixed number of iterations', async () => {
    hits = 0;
    maxInFlight = 0;
    const collection = collectionWith(['/a', '/b']);
    const samples: LoadSample[] = [];
    const run = startLoadTest(
      { collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null) },
      { virtualUsers: 5, iterationsPerUser: 3, rampUpMs: 0, thinkTimeMs: 0, runScripts: true },
      (s) => samples.push(s),
    );
    await run.done;
    expect(samples).toHaveLength(5 * 3 * 2);
    expect(hits).toBe(30);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(new Set(samples.map((s) => s.vu))).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('stops at the deadline, and on stop()', async () => {
    const collection = collectionWith(['/a']);
    const samples: LoadSample[] = [];
    const started = Date.now();
    const run = startLoadTest(
      { collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null) },
      { virtualUsers: 2, durationMs: 300, rampUpMs: 0, thinkTimeMs: 0, runScripts: false },
      (s) => samples.push(s),
    );
    await run.done;
    expect(Date.now() - started).toBeLessThan(1500);
    expect(samples.length).toBeGreaterThan(2);

    const endless = startLoadTest(
      { collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null) },
      { virtualUsers: 3, rampUpMs: 60_000, thinkTimeMs: 0, runScripts: false },
      () => {},
    );
    setTimeout(() => endless.stop(), 150);
    const t = Date.now();
    await endless.done;
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it('summarizes errors, status codes and per-request latency, and checks thresholds', async () => {
    const collection = collectionWith(['/a', '/fail'], "pm.test('2xx', () => pm.response.to.be.ok);");
    const samples: LoadSample[] = [];
    const run = startLoadTest(
      { collection, globals: [], environment: null, targets: headlessTargetsFor(collection, null) },
      { virtualUsers: 2, iterationsPerUser: 2, rampUpMs: 0, thinkTimeMs: 0, runScripts: true },
      (s) => samples.push(s),
    );
    await run.done;
    const summary = summarize(samples, 1000);
    expect(summary.requests).toBe(8);
    expect(summary.failed).toBe(4);
    expect(summary.errorRate).toBe(0.5);
    expect(summary.statusCodes).toEqual({ 200: 4, 500: 4 });
    expect(summary.byRequest.map((r) => [r.name, r.count, r.errorRate]).sort()).toEqual([
      ['/a', 4, 0],
      ['/fail', 4, 1],
    ]);
    expect(summary.latency.p50).toBeGreaterThanOrEqual(15);
    expect(checkThreshold('errors<1', summary).passed).toBe(false);
    expect(checkThreshold('p95 < 5000ms', summary).passed).toBe(true);
    expect(checkThreshold('rps>=1', summary)).toMatchObject({ passed: true, actual: 8 });
    expect(() => checkThreshold('latency<5', summary)).toThrow(/Can't read threshold/);
  });
});
