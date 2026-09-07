import { describe, it, expect } from 'vitest';
import { pathVariableNames, normalizeUrl, splitUrl, mergeParamsFromUrl, withUrlParams } from '../send';
import { kv } from '../factory';

describe('pathVariableNames', () => {
  it('finds :name segments, ignoring the scheme', () => {
    expect(pathVariableNames('https://api.example.com/users/:id/posts/:postId')).toEqual(['id', 'postId']);
  });
  it('ignores query/hash and dedupes', () => {
    expect(pathVariableNames('https://x.com/:id?foo=:id#:id')).toEqual(['id']);
  });
  it('returns an empty array when there are none', () => {
    expect(pathVariableNames('https://x.com/users')).toEqual([]);
  });
});

describe('normalizeUrl', () => {
  it('leaves a URL with a scheme untouched', () => {
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });
  it('adds http:// for localhost and 127.0.0.1', () => {
    expect(normalizeUrl('localhost:3000/api')).toBe('http://localhost:3000/api');
    expect(normalizeUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });
  it('adds https:// for everything else', () => {
    expect(normalizeUrl('api.example.com/v1')).toBe('https://api.example.com/v1');
  });
  it('passes an empty string through', () => {
    expect(normalizeUrl('  ')).toBe('');
  });
});

describe('splitUrl', () => {
  it('splits base/query/hash', () => {
    expect(splitUrl('https://x.com/a?b=1&c=2#frag')).toEqual({ base: 'https://x.com/a', query: 'b=1&c=2', hash: '#frag' });
  });
  it('handles a URL with no query or hash', () => {
    expect(splitUrl('https://x.com/a')).toEqual({ base: 'https://x.com/a', query: '', hash: '' });
  });
});

describe('mergeParamsFromUrl', () => {
  it('adds new query params found in the URL to the params grid', () => {
    const merged = mergeParamsFromUrl('https://x.com/a?foo=1&bar=2', []);
    expect(merged?.map((p) => [p.key, p.value])).toEqual([['foo', '1'], ['bar', '2']]);
  });
  it('does not duplicate a param already present', () => {
    const existing = [kv({ key: 'foo', value: '1' })];
    expect(mergeParamsFromUrl('https://x.com/a?foo=1', existing)).toBeNull();
  });
  it('returns null when the URL has no query string', () => {
    expect(mergeParamsFromUrl('https://x.com/a', [])).toBeNull();
  });
});

describe('withUrlParams', () => {
  it('syncs a request whose URL carries a query string not yet in its params grid', () => {
    const request = { url: 'https://x.com/a?q=1', params: [] } as any;
    const next = withUrlParams(request);
    expect(next.params.some((p: any) => p.key === 'q' && p.value === '1')).toBe(true);
  });
});
