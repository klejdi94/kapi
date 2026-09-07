import { describe, it, expect } from 'vitest';
import { applyAuth, effectiveAuth, authStrings, isTokenExpired } from '../auth';
import { emptyAuth } from '../factory';
import { buildScope } from '../variables';
import { newWorkspace } from '../factory';

const scope = () => buildScope(newWorkspace('W'), null);

describe('effectiveAuth', () => {
  it('stops climbing at the first non-inherit entry, walking from the end', () => {
    const chain = [emptyAuth('bearer'), emptyAuth('inherit'), emptyAuth('basic')];
    const { auth, inheritedFrom } = effectiveAuth(chain);
    expect(auth.type).toBe('basic');
    expect(inheritedFrom).toBe(2);
  });

  it('falls back to none when the whole chain is inherit or empty', () => {
    const { auth, inheritedFrom } = effectiveAuth([emptyAuth('inherit'), undefined]);
    expect(auth.type).toBe('none');
    expect(inheritedFrom).toBe(-1);
  });
});

describe('applyAuth', () => {
  it('bearer: adds an Authorization header when a token is set', async () => {
    const auth = { ...emptyAuth('bearer'), bearer: { token: 'abc' } };
    const result = await applyAuth(auth, scope());
    expect(result.headers[0]).toMatchObject({ key: 'Authorization', value: 'Bearer abc' });
    expect(result.warning).toBeNull();
  });

  it('bearer: warns and adds nothing when the token is empty', async () => {
    const result = await applyAuth(emptyAuth('bearer'), scope());
    expect(result.headers).toHaveLength(0);
    expect(result.warning).toMatch(/no token/i);
  });

  it('basic: base64-encodes user:pass', async () => {
    const auth = { ...emptyAuth('basic'), basic: { username: 'u', password: 'p' } };
    const result = await applyAuth(auth, scope());
    expect(result.headers[0].value).toBe(`Basic ${btoa('u:p')}`);
  });

  it('apikey: goes to query params when in=query, headers otherwise', async () => {
    const inQuery = { ...emptyAuth('apikey'), apikey: { key: 'api_key', value: 'v', in: 'query' as const } };
    const queryResult = await applyAuth(inQuery, scope());
    expect(queryResult.params[0]).toMatchObject({ key: 'api_key', value: 'v' });
    expect(queryResult.headers).toHaveLength(0);

    const inHeader = { ...emptyAuth('apikey'), apikey: { key: 'api_key', value: 'v', in: 'header' as const } };
    const headerResult = await applyAuth(inHeader, scope());
    expect(headerResult.headers[0]).toMatchObject({ key: 'api_key', value: 'v' });
  });

  it('jwt: signs an HS256 token when a secret is set', async () => {
    const auth = { ...emptyAuth('jwt'), jwt: { ...emptyAuth('jwt').jwt!, secret: 'shh', payload: '{"sub":"1"}' } };
    const result = await applyAuth(auth, scope());
    const token = result.headers[0].value.replace('Bearer ', '');
    expect(token.split('.')).toHaveLength(3);
  });

  it('custom: uses the given header name and resolved value', async () => {
    const auth = { ...emptyAuth('custom'), custom: { header: 'X-Api-Key', value: 'v' } };
    const result = await applyAuth(auth, scope());
    expect(result.headers[0]).toMatchObject({ key: 'X-Api-Key', value: 'v' });
  });

  it('none/inherit: adds nothing and warns nothing', async () => {
    expect(await applyAuth(emptyAuth('none'), scope())).toEqual({ headers: [], params: [], warning: null });
  });
});

describe('authStrings', () => {
  it('returns the resolvable strings for each auth type', () => {
    expect(authStrings({ ...emptyAuth('bearer'), bearer: { token: 't' } })).toEqual(['t']);
    expect(authStrings(emptyAuth('none'))).toEqual([]);
  });
});

describe('isTokenExpired', () => {
  it('is true once expiresAt is in the past', () => {
    const request = { auth: { ...emptyAuth('oauth2'), oauth2: { ...emptyAuth('oauth2').oauth2!, expiresAt: Date.now() - 1000 } } } as any;
    expect(isTokenExpired(request)).toBe(true);
  });
  it('is false with no expiresAt set', () => {
    const request = { auth: emptyAuth('oauth2') } as any;
    expect(isTokenExpired(request)).toBe(false);
  });
});
