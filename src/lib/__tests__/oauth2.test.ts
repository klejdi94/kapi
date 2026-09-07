import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchClientCredentialsToken, fetchPasswordToken, refreshOAuthToken } from '../oauth2';
import { emptyAuth, newWorkspace } from '../factory';
import { buildScope } from '../variables';

const scope = () => buildScope(newWorkspace('W'), null);

describe('fetchClientCredentialsToken', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs grant_type=client_credentials with client_id/secret in the body when clientAuth is "body"', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }));
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token', clientId: 'id', clientSecret: 'secret', clientAuth: 'body' as const };
    const result = await fetchClientCredentialsToken(config, scope());
    expect(result.accessToken).toBe('tok');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://idp.example.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('id');
    expect(body.get('client_secret')).toBe('secret');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('sends client_id/secret as a Basic auth header when clientAuth is "basic"', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }));
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token', clientId: 'id', clientSecret: 'secret', clientAuth: 'basic' as const };
    await fetchClientCredentialsToken(config, scope());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(`Basic ${btoa('id:secret')}`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get('client_id')).toBeNull();
  });

  it('throws with the IdP-provided error_description on a failed request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client', error_description: 'bad secret' }), { status: 401 }));
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token' };
    await expect(fetchClientCredentialsToken(config, scope())).rejects.toThrow('bad secret');
  });

  it('resolves {{variables}} in the token URL and credentials', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }));
    const workspace = newWorkspace('W');
    workspace.globals = [
      { id: '1', key: 'tokenUrl', value: 'https://idp.example.com/token', enabled: true },
      { id: '2', key: 'clientId', value: 'resolved-id', enabled: true },
    ] as any;
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: '{{tokenUrl}}', clientId: '{{clientId}}' };
    await fetchClientCredentialsToken(config, buildScope(workspace, null));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://idp.example.com/token');
    expect(new URLSearchParams(init.body as string).get('client_id')).toBe('resolved-id');
  });
});

describe('fetchPasswordToken', () => {
  it('POSTs grant_type=password with username/password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token', username: 'u', password: 'p' };
    const result = await fetchPasswordToken(config, scope());
    expect(result.accessToken).toBe('tok');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('u');
    expect(body.get('password')).toBe('p');
    vi.unstubAllGlobals();
  });
});

describe('refreshOAuthToken', () => {
  it('rejects when there is no stored refresh token', async () => {
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token' };
    await expect(refreshOAuthToken(config, scope())).rejects.toThrow(/no refresh token/i);
  });

  it('POSTs grant_type=refresh_token with the stored token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'new-tok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const config = { ...emptyAuth('oauth2').oauth2!, tokenUrl: 'https://idp.example.com/token', refreshToken: 'rt-1' };
    const result = await refreshOAuthToken(config, scope());
    expect(result.accessToken).toBe('new-tok');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
    vi.unstubAllGlobals();
  });
});
