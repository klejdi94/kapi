import { describe, expect, it } from 'vitest';
import { diffHeaders, diffJson, pathMatcher } from '../envCompare';

describe('environment comparison', () => {
  it('diffs JSON by path', () => {
    const a = { id: 1, name: 'A', tags: ['x', 'y'], meta: { region: 'eu', updatedAt: 't1' }, gone: true };
    const b = { id: 1, name: 'B', tags: ['x'], meta: { region: 'us', updatedAt: 't2' }, extra: null, 'odd key': 1 };
    expect(diffJson(a, b)).toEqual([
      { path: '$.name', kind: 'changed', a: 'A', b: 'B' },
      { path: '$.tags[1]', kind: 'removed', a: 'y' },
      { path: '$.meta.region', kind: 'changed', a: 'eu', b: 'us' },
      { path: '$.meta.updatedAt', kind: 'changed', a: 't1', b: 't2' },
      { path: '$.gone', kind: 'removed', a: true },
      { path: '$.extra', kind: 'added', b: null },
      { path: '$["odd key"]', kind: 'added', b: 1 },
    ]);
    expect(diffJson({ n: 1 }, { n: '1' })).toEqual([{ path: '$.n', kind: 'type', a: 1, b: '1' }]);
  });

  it('ignores paths, with wildcards', () => {
    const ignore = pathMatcher(['meta.updatedAt', '$.items[*].etag']);
    const a = { meta: { updatedAt: 1, v: 1 }, items: [{ etag: 'a', id: 1 }, { etag: 'b', id: 2 }] };
    const b = { meta: { updatedAt: 2, v: 1 }, items: [{ etag: 'c', id: 1 }, { etag: 'd', id: 3 }] };
    expect(diffJson(a, b, ignore)).toEqual([{ path: '$.items[1].id', kind: 'changed', a: 2, b: 3 }]);
  });

  it('diffs headers case-insensitively and skips volatile ones', () => {
    const a: [string, string][] = [['Content-Type', 'application/json'], ['Date', 'Mon'], ['X-Version', '1'], ['Vary', 'Accept']];
    const b: [string, string][] = [['content-type', 'application/json'], ['date', 'Tue'], ['x-version', '2'], ['Cache-Control', 'no-store']];
    expect(diffHeaders(a, b)).toEqual([
      { name: 'cache-control', a: null, b: 'no-store' },
      { name: 'vary', a: 'Accept', b: null },
      { name: 'x-version', a: '1', b: '2' },
    ]);
    expect(diffHeaders(a, b, false).some((h) => h.name === 'date')).toBe(true);
  });
});
