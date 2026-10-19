import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ciWorkflowFor, isDue, runMonitor, shouldNotify } from '../monitors';
import { kv, newCollection, newEnvironment, newRequestNode, seedWorkspace } from '../factory';
import type { Monitor } from '@/types';

const monitor = (over: Partial<Monitor> = {}): Monitor => ({
  id: 'm',
  name: 'API health',
  collectionId: 'c',
  scopeNodeId: null,
  environmentId: null,
  intervalMinutes: 15,
  enabled: true,
  notify: 'failures',
  ...over,
});

describe('monitor scheduling', () => {
  it('is due on first run and after its interval, never when disabled', () => {
    const now = 1_000_000_000;
    expect(isDue(monitor(), now)).toBe(true);
    expect(isDue(monitor({ lastRunAt: now - 14 * 60_000 }), now)).toBe(false);
    expect(isDue(monitor({ lastRunAt: now - 15 * 60_000 }), now)).toBe(true);
    expect(isDue(monitor({ enabled: false }), now)).toBe(false);
  });

  it('notifies according to the setting', () => {
    expect(shouldNotify(monitor(), 'failed')).toBe(true);
    expect(shouldNotify(monitor(), 'passed')).toBe(false);
    expect(shouldNotify(monitor({ notify: 'changes', lastStatus: 'passed' }), 'failed')).toBe(true);
    expect(shouldNotify(monitor({ notify: 'changes', lastStatus: 'failed' }), 'failed')).toBe(false);
    expect(shouldNotify(monitor({ notify: 'changes', lastStatus: 'failed' }), 'passed')).toBe(true);
    expect(shouldNotify(monitor({ notify: 'changes' }), 'failed')).toBe(false); // first run: nothing changed
    expect(shouldNotify(monitor({ notify: 'never' }), 'error')).toBe(false);
  });

  it('writes a CI workflow that runs the same check', () => {
    const yaml = ciWorkflowFor(monitor({ intervalMinutes: 15 }), 'api.kapi.json', 'staging.json');
    expect(yaml).toContain("cron: '*/15 * * * *'");
    expect(yaml).toContain('npx -y kapi run api.kapi.json --env staging.json');
    expect(ciWorkflowFor(monitor({ intervalMinutes: 1 }), 'a.json', null)).toContain("cron: '*/5 * * * *'");
    expect(ciWorkflowFor(monitor({ intervalMinutes: 360 }), 'a.json', null)).toContain("cron: '0 */6 * * *'");
  });
});

describe('running a monitor', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(req.url === '/down' ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('runs with the chosen environment and records a history entry', async () => {
    const workspace = seedWorkspace();
    const env = newEnvironment('staging');
    env.variables = [kv({ key: 'token', value: 'T' })];
    workspace.environments.push(env);
    const collection = newCollection('api');
    collection.id = 'c';
    collection.items = [
      newRequestNode('up', { url: `${base}/up`, params: [], headers: [kv({ key: 'Authorization', value: 'Bearer {{token}}' })], testScript: "pm.test('auth', () => pm.expect(pm.response.json().auth).to.equal('Bearer T'));" }),
      newRequestNode('down', { url: `${base}/down`, params: [], testScript: "pm.test('ok', () => pm.response.to.be.ok);" }),
    ];
    workspace.collections.push(collection);

    const outcome = await runMonitor(monitor({ environmentId: env.id }), workspace);
    expect(outcome.status).toBe('failed');
    expect(outcome.entry).toMatchObject({ monitorId: 'm', collectionName: 'api', passed: 1, failed: 1, errored: 0 });
    expect(outcome.summary).toMatch(/1 of 2 failed — first: down \(ok\)/);
  });

  it('reports a deleted collection instead of throwing', async () => {
    const outcome = await runMonitor(monitor({ collectionId: 'gone' }), seedWorkspace());
    expect(outcome.status).toBe('error');
  });
});
