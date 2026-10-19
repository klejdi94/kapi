import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSecretRef, setSecretRefResolver, withResolvedSecretRefs } from '../secretRefs';
import { commandFor, parseSecretRef } from '@/cli/secretRefsNode';
import type { VarScope } from '../variables';

const scope = (entries: Record<string, [string, 'environment' | 'global' | 'collection']>): VarScope =>
  new Map(Object.entries(entries).map(([k, [value, source]]) => [k, { value, source, origin: source }]));

afterEach(() => setSecretRefResolver(null));

describe('secret references', () => {
  it('recognises the three schemes and nothing else', () => {
    expect(isSecretRef('op://Private/GitHub/token')).toBe(true);
    expect(isSecretRef(' awssm://db#password ')).toBe(true);
    expect(isSecretRef('vault://kv/app#token')).toBe(true);
    expect(isSecretRef('https://op.example.com')).toBe(false);
    expect(isSecretRef('Bearer op://x/y/z')).toBe(false);
  });

  it('resolves environment and global references used by the request, directly or nested', async () => {
    const resolver = vi.fn(async (ref: string) => `secret-for-${ref}`);
    setSecretRefResolver(resolver);
    const base = scope({
      token: ['op://Private/GitHub/token', 'environment'],
      header: ['Bearer {{token}}', 'environment'],
      dbpass: ['awssm://db#password', 'global'],
      unused: ['vault://kv/app#x', 'environment'],
    });
    const out = await withResolvedSecretRefs(['{{header}}', '{{dbpass}}'], base, 'GET /');
    expect(out.get('token')?.value).toBe('secret-for-op://Private/GitHub/token');
    expect(out.get('dbpass')?.value).toBe('secret-for-awssm://db#password');
    expect(out.get('unused')?.value).toBe('vault://kv/app#x'); // not used, not resolved
    expect(base.get('token')?.value).toBe('op://Private/GitHub/token'); // the original scope is untouched
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('never resolves references in collection variables', async () => {
    const resolver = vi.fn(async () => 'leaked');
    setSecretRefResolver(resolver);
    const base = scope({ trap: ['op://Private/Bank/password', 'collection'] });
    const out = await withResolvedSecretRefs(['{{trap}}'], base, 'GET /');
    expect(out).toBe(base);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('caches and de-duplicates lookups, and reports failures with the variable name', async () => {
    let calls = 0;
    setSecretRefResolver(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'v';
    });
    const base = scope({ a: ['op://v/i/f', 'environment'] });
    await Promise.all([withResolvedSecretRefs(['{{a}}'], base, ''), withResolvedSecretRefs(['{{a}}'], base, '')]);
    await withResolvedSecretRefs(['{{a}}'], base, '');
    expect(calls).toBe(1);

    setSecretRefResolver(async () => {
      throw new Error('Access wasn\'t allowed');
    });
    await expect(withResolvedSecretRefs(['{{a}}'], base, '')).rejects.toThrow("{{a}} — Access wasn't allowed");
  });

  it('leaves everything alone without a resolver', async () => {
    const base = scope({ a: ['op://v/i/f', 'environment'] });
    expect(await withResolvedSecretRefs(['{{a}}'], base, '')).toBe(base);
  });
});

describe('CLI reference parsing (mirrors secret_refs.rs)', () => {
  it('parses each provider into a fixed argument list', () => {
    expect(commandFor(parseSecretRef('op://Private/GitHub/token'))).toEqual(['op', ['read', '--no-newline', 'op://Private/GitHub/token']]);
    expect(commandFor(parseSecretRef('awssm://prod/db?region=eu-west-1#password'))).toEqual([
      'aws',
      ['secretsmanager', 'get-secret-value', '--secret-id', 'prod/db', '--query', 'SecretString', '--output', 'text', '--region', 'eu-west-1'],
    ]);
    expect(commandFor(parseSecretRef('vault://kv/app#token'))).toEqual(['vault', ['kv', 'get', '-field=token', 'kv/app']]);
  });

  it('rejects option injection and malformed references', () => {
    for (const bad of ['awssm://--profile=evil', 'vault://-address=http://evil#x', 'vault://secret/app#-x', 'op://a/b', 'op://a/b c/d', 'awssm://x?region=us-east-1 --debug', 'https://example.com']) {
      expect(() => parseSecretRef(bad), bad).toThrow();
    }
  });
});
