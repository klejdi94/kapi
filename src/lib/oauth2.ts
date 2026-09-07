import { invoke } from '@tauri-apps/api/core';
import type { AuthConfig } from '@/types';
import { resolve, type VarScope } from './variables';
import { isDesktop } from './transport';

/**
 * A fixed loopback port rather than "any free port": the user has to
 * register this exact redirect URI with their OAuth app once, and it has to
 * still be the one kapi listens on next time. The Rust side
 * (`kapi_oauth_listen`) binds this port and waits for the IdP's redirect.
 */
export const OAUTH_CALLBACK_PORT = 17872;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/callback`;

type Oauth2Config = NonNullable<AuthConfig['oauth2']>;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 PKCE pair — a random verifier and its SHA-256 (S256) challenge. */
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomHex(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlFromBytes(new Uint8Array(digest)) };
}

export interface OAuthTokenResult {
  accessToken: string;
  expiresAt: number | null;
  refreshToken: string | null;
}

function parseTokenResponse(json: Record<string, unknown>): OAuthTokenResult {
  if (typeof json.error === 'string') throw new Error(typeof json.error_description === 'string' ? json.error_description : json.error);
  if (typeof json.access_token !== 'string') throw new Error('The token endpoint did not return an access_token.');
  return {
    accessToken: json.access_token,
    expiresAt: typeof json.expires_in === 'number' ? Date.now() + json.expires_in * 1000 : null,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
  };
}

/** Every grant below is a `POST application/x-www-form-urlencoded` to the token endpoint — this is the one place that actually sends it, through the native HTTP client so CORS never enters into it. */
async function postForm(url: string, body: Record<string, string>, basicAuth?: { user: string; pass: string }): Promise<OAuthTokenResult> {
  if (!url.trim()) throw new Error('No token URL set.');
  const doFetch = isDesktop() ? (await import('@tauri-apps/plugin-http')).fetch : fetch;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (basicAuth) headers.Authorization = `Basic ${btoa(`${basicAuth.user}:${basicAuth.pass}`)}`;

  const response = await doFetch(url, { method: 'POST', headers, body: new URLSearchParams(body).toString() });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`The token endpoint didn't return JSON (status ${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok && typeof json.access_token !== 'string') {
    const message = (typeof json.error_description === 'string' && json.error_description) || (typeof json.error === 'string' && json.error);
    throw new Error(message || `Token request failed with status ${response.status}`);
  }
  return parseTokenResponse(json);
}

/** Adds client auth the way `clientAuth` says: Basic header, or client_id/secret in the body. */
function withClientAuth(tokenUrl: string, body: Record<string, string>, config: Oauth2Config, scope: VarScope): Promise<OAuthTokenResult> {
  const clientId = resolve(config.clientId, scope);
  const clientSecret = resolve(config.clientSecret, scope);
  if (config.clientAuth === 'basic' && clientId) return postForm(tokenUrl, body, { user: clientId, pass: clientSecret });
  const withBody = { ...body, ...(clientId ? { client_id: clientId } : {}), ...(clientSecret ? { client_secret: clientSecret } : {}) };
  return postForm(tokenUrl, withBody);
}

/** Client Credentials — machine-to-machine, no browser involved. */
export function fetchClientCredentialsToken(config: Oauth2Config, scope: VarScope): Promise<OAuthTokenResult> {
  const body: Record<string, string> = { grant_type: 'client_credentials' };
  const resolvedScope = resolve(config.scope, scope);
  const audience = resolve(config.audience, scope);
  if (resolvedScope) body.scope = resolvedScope;
  if (audience) body.audience = audience;
  return withClientAuth(resolve(config.tokenUrl, scope), body, config, scope);
}

/** Resource Owner Password Credentials — the user's own username/password, traded directly for a token. */
export function fetchPasswordToken(config: Oauth2Config, scope: VarScope): Promise<OAuthTokenResult> {
  const body: Record<string, string> = {
    grant_type: 'password',
    username: resolve(config.username, scope),
    password: resolve(config.password, scope),
  };
  const resolvedScope = resolve(config.scope, scope);
  if (resolvedScope) body.scope = resolvedScope;
  return withClientAuth(resolve(config.tokenUrl, scope), body, config, scope);
}

/** Refresh Token — renews an expired access token without another browser round trip. */
export function refreshOAuthToken(config: Oauth2Config, scope: VarScope): Promise<OAuthTokenResult> {
  if (!config.refreshToken) return Promise.reject(new Error('No refresh token stored for this request.'));
  return withClientAuth(resolve(config.tokenUrl, scope), { grant_type: 'refresh_token', refresh_token: config.refreshToken }, config, scope);
}

/**
 * Authorization Code + PKCE — opens the system browser at the IdP's login
 * page, then waits on the Rust-side loopback listener for its redirect.
 * `onWaiting` fires right before the browser opens, so the caller can show a
 * "waiting for you to finish signing in…" state with a cancel button wired
 * to `cancelAuthorizationCode()`.
 */
export async function fetchAuthorizationCodeToken(config: Oauth2Config, scope: VarScope, onWaiting?: () => void): Promise<OAuthTokenResult> {
  if (!isDesktop()) throw new Error('The Authorization Code flow needs the desktop app — it opens your system browser and listens for its redirect.');
  const authUrlBase = resolve(config.authUrl, scope);
  if (!authUrlBase.trim()) throw new Error('No authorization URL set.');

  const { verifier, challenge } = await pkcePair();
  const state = randomHex(16);
  const authUrl = new URL(authUrlBase);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', resolve(config.clientId, scope));
  authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  const resolvedScope = resolve(config.scope, scope);
  const audience = resolve(config.audience, scope);
  if (resolvedScope) authUrl.searchParams.set('scope', resolvedScope);
  if (audience) authUrl.searchParams.set('audience', audience);

  const listenPromise = invoke<string>('kapi_oauth_listen', { port: OAUTH_CALLBACK_PORT });
  onWaiting?.();
  const { open } = await import('@tauri-apps/plugin-shell');
  await open(authUrl.toString());

  const query = await listenPromise;
  const params = new URLSearchParams(query);
  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error') || 'Authorization failed.');
  const code = params.get('code');
  if (!code) throw new Error('The redirect had no authorization code.');
  if (params.get('state') !== state) throw new Error('State mismatch — the redirect did not match this request.');

  return withClientAuth(
    resolve(config.tokenUrl, scope),
    { grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT_URI, code_verifier: verifier },
    config,
    scope,
  );
}

/** Frees the loopback port immediately instead of waiting out its two-minute timeout. */
export async function cancelAuthorizationCode(): Promise<void> {
  await invoke('kapi_oauth_cancel');
}

/** Dispatches to the grant named by `config.grantType`. */
export function fetchOAuthToken(config: Oauth2Config, scope: VarScope, onWaiting?: () => void): Promise<OAuthTokenResult> {
  switch (config.grantType) {
    case 'client_credentials':
      return fetchClientCredentialsToken(config, scope);
    case 'password':
      return fetchPasswordToken(config, scope);
    case 'authorization_code_pkce':
      return fetchAuthorizationCodeToken(config, scope, onWaiting);
    case 'implicit':
      return Promise.reject(
        new Error('The Implicit grant hands the token back in the redirect fragment, which no server-side listener can read — use Authorization Code + PKCE, or paste a token you already have.'),
      );
    default:
      return Promise.reject(new Error(`Unknown grant type: ${config.grantType}`));
  }
}
