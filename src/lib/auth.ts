import type { AuthConfig, AuthType, KV, RequestDef } from '@/types';
import { encodeBase64, base64ToBytes, base64UrlFromBytes, base64UrlFromText } from './base64';
import { kv } from './factory';
import { resolve, type VarScope } from './variables';

export const AUTH_LABELS: Record<AuthType, string> = {
  none: 'No auth',
  inherit: 'Inherit from parent',
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apikey: 'API key',
  jwt: 'JWT bearer',
  oauth2: 'OAuth 2.0',
  custom: 'Custom header',
};

export interface AppliedAuth {
  headers: KV[];
  params: KV[];
  /** Explains why nothing was applied, shown inline in the Auth tab. */
  warning: string | null;
}

/**
 * Walks collection → folders → request and returns the config that actually
 * applies. `inherit` keeps climbing; anything else stops the walk.
 */
export function effectiveAuth(chain: (AuthConfig | undefined)[]): { auth: AuthConfig; inheritedFrom: number } {
  for (let i = chain.length - 1; i >= 0; i--) {
    const auth = chain[i];
    if (!auth) continue;
    if (auth.type !== 'inherit') return { auth, inheritedFrom: i };
  }
  return { auth: { type: 'none' }, inheritedFrom: -1 };
}

async function signJwt(config: NonNullable<AuthConfig['jwt']>, scope: VarScope): Promise<string> {
  const alg = config.algorithm;
  const header = base64UrlFromText(JSON.stringify({ alg, typ: 'JWT' }));
  const payloadText = resolve(config.payload, scope).trim() || '{}';
  // Normalise so a pretty-printed payload doesn't end up in the token verbatim.
  let payloadJson = payloadText;
  try {
    payloadJson = JSON.stringify(JSON.parse(payloadText));
  } catch {
    /* leave the user's text alone and let the server reject it */
  }
  const payload = base64UrlFromText(payloadJson);
  const secretText = resolve(config.secret, scope);
  const keyBytes = config.secretIsBase64 ? base64ToBytes(secretText) : new TextEncoder().encode(secretText);
  const hash = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }[alg];
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash }, false, ['sign']);
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return `${header}.${payload}.${base64UrlFromBytes(new Uint8Array(signature))}`;
}

export async function applyAuth(auth: AuthConfig, scope: VarScope): Promise<AppliedAuth> {
  const headers: KV[] = [];
  const params: KV[] = [];
  const r = (text: string | undefined) => resolve(text ?? '', scope);

  switch (auth.type) {
    case 'bearer': {
      const token = r(auth.bearer?.token);
      if (!token) return { headers, params, warning: 'No token set — the Authorization header was not sent.' };
      headers.push(kv({ key: 'Authorization', value: `Bearer ${token}`, auto: true }));
      break;
    }
    case 'basic': {
      const user = r(auth.basic?.username);
      const pass = r(auth.basic?.password);
      if (!user && !pass) return { headers, params, warning: 'No credentials set — the Authorization header was not sent.' };
      headers.push(kv({ key: 'Authorization', value: `Basic ${encodeBase64(`${user}:${pass}`)}`, auto: true }));
      break;
    }
    case 'apikey': {
      const key = r(auth.apikey?.key);
      const value = r(auth.apikey?.value);
      if (!key) return { headers, params, warning: 'No key name set — nothing was added to the request.' };
      const row = kv({ key, value, auto: true });
      if (auth.apikey?.in === 'query') params.push(row);
      else headers.push(row);
      break;
    }
    case 'jwt': {
      const config = auth.jwt;
      if (!config?.secret) return { headers, params, warning: 'No signing secret set — no token was generated.' };
      try {
        const token = await signJwt(config, scope);
        if (config.addTo === 'query') {
          params.push(kv({ key: config.queryKey || 'token', value: token, auto: true }));
        } else {
          const prefix = config.headerPrefix ? `${config.headerPrefix} ` : '';
          headers.push(kv({ key: 'Authorization', value: `${prefix}${token}`, auto: true }));
        }
      } catch (err) {
        return { headers, params, warning: `Could not sign the token: ${(err as Error).message}` };
      }
      break;
    }
    case 'oauth2': {
      const token = r(auth.oauth2?.accessToken);
      if (!token) return { headers, params, warning: 'No access token yet — use “Get new token”, or paste one.' };
      const prefix = auth.oauth2?.headerPrefix ? `${auth.oauth2.headerPrefix} ` : '';
      headers.push(kv({ key: 'Authorization', value: `${prefix}${token}`, auto: true }));
      break;
    }
    case 'custom': {
      const name = r(auth.custom?.header);
      if (!name) return { headers, params, warning: 'No header name set — nothing was added to the request.' };
      headers.push(kv({ key: name, value: r(auth.custom?.value), auto: true }));
      break;
    }
    case 'none':
    case 'inherit':
    default:
      break;
  }

  return { headers, params, warning: null };
}

/** Strings that need variable substitution before the request is described. */
export function authStrings(auth: AuthConfig): string[] {
  switch (auth.type) {
    case 'bearer': return [auth.bearer?.token ?? ''];
    case 'basic': return [auth.basic?.username ?? '', auth.basic?.password ?? ''];
    case 'apikey': return [auth.apikey?.key ?? '', auth.apikey?.value ?? ''];
    case 'jwt': return [auth.jwt?.secret ?? '', auth.jwt?.payload ?? ''];
    case 'oauth2': return [auth.oauth2?.accessToken ?? ''];
    case 'custom': return [auth.custom?.header ?? '', auth.custom?.value ?? ''];
    default: return [];
  }
}

export function isTokenExpired(request: RequestDef): boolean {
  const expiresAt = request.auth.oauth2?.expiresAt;
  return typeof expiresAt === 'number' && expiresAt > 0 && expiresAt < Date.now();
}
