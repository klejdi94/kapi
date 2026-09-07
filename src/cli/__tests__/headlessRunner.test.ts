import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { headlessTargetsFor, runHeadless } from '../headlessRunner';
import { newCollection, newRequestNode, emptyAuth } from '@/lib/factory';
import type { Collection } from '@/types';

function buildCollection(): Collection {
  const collection = newCollection('Demo');
  const login = newRequestNode('Login', { method: 'GET', url: 'https://api.example.com/login', auth: emptyAuth('none') });
  login.request.testScript = "pm.environment.set('token', 'abc123');";
  const whoami = newRequestNode('Who am I', { method: 'GET', url: 'https://api.example.com/me', auth: emptyAuth('none') });
  whoami.request.headers = [{ id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true, description: '' }];
  collection.items = [login, whoami];
  return collection;
}

describe('headlessTargetsFor', () => {
  it('flattens the whole collection when no folder is given', () => {
    const targets = headlessTargetsFor(buildCollection(), null);
    expect(targets.map((t) => t.node.name)).toEqual(['Login', 'Who am I']);
  });

  it('scopes to a single folder', () => {
    const collection = buildCollection();
    const folder = { id: 'f1', type: 'folder' as const, name: 'Sub', expanded: true, auth: emptyAuth('none'), headers: [], items: [collection.items[1]] };
    collection.items = [collection.items[0], folder];
    expect(headlessTargetsFor(collection, 'f1').map((t) => t.node.name)).toEqual(['Who am I']);
  });
});

describe('runHeadless', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/login')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("carries a variable set by one request's test script into the next request's headers", async () => {
    const collection = buildCollection();
    const targets = headlessTargetsFor(collection, null);
    const results: any[] = [];

    await runHeadless({ collection, globals: [], environment: null, targets, iterations: 1, dataRows: [], delayMs: 0, onResult: (r) => results.push(r) });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'passed')).toBe(true);

    const secondCallHeaders = fetchMock.mock.calls[1][1].headers as [string, string][];
    const authHeader = secondCallHeaders.find(([k]) => k.toLowerCase() === 'authorization');
    expect(authHeader?.[1]).toBe('Bearer abc123');
  });

  it('reports a request-level error without throwing, and keeps running the rest', async () => {
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const collection = buildCollection();
    const targets = headlessTargetsFor(collection, null);
    const results: any[] = [];
    await runHeadless({ collection, globals: [], environment: null, targets, iterations: 1, dataRows: [], delayMs: 0, onResult: (r) => results.push(r) });
    expect(results[0].status).toBe('error');
    expect(results).toHaveLength(2);
  });
});
