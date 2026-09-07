import type { StoredCookie } from '@/types';
import { parseSetCookie } from './format';

function domainMatches(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

function pathMatches(cookiePath: string, urlPath: string): boolean {
  const p = cookiePath || '/';
  if (p === '/') return true;
  return urlPath === p || urlPath.startsWith(p.endsWith('/') ? p : `${p}/`);
}

/** Parses every `Set-Cookie` header from one response into jar entries, defaulting domain/path to the request's own. */
export function cookiesFromSetHeaders(url: string, setCookieHeaders: string[]): StoredCookie[] {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return [];
  }
  const now = Date.now();

  return setCookieHeaders
    .map((raw): StoredCookie | null => {
      const parsed = parseSetCookie(raw);
      if (!parsed.name) return null;
      let expires: number | null = null;
      if (parsed.maxAge) {
        const seconds = Number(parsed.maxAge);
        if (!Number.isNaN(seconds)) expires = now + seconds * 1000;
      } else if (parsed.expires) {
        const t = Date.parse(parsed.expires);
        if (!Number.isNaN(t)) expires = t;
      }
      return {
        name: parsed.name,
        value: parsed.value,
        domain: parsed.domain || host,
        path: parsed.path || '/',
        expires,
        secure: parsed.secure,
        httpOnly: parsed.httpOnly,
        setAt: now,
      };
    })
    .filter((c): c is StoredCookie => c !== null);
}

/** `name=value; name2=value2` for cookies matching this URL, or null when there's nothing to attach. */
export function cookieHeaderFor(cookies: StoredCookie[], url: string): string | null {
  let host: string;
  let path: string;
  let isHttps: boolean;
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = parsed.pathname || '/';
    isHttps = parsed.protocol === 'https:';
  } catch {
    return null;
  }
  const now = Date.now();
  const matching = cookies.filter(
    (c) => (c.expires === null || c.expires > now) && domainMatches(c.domain, host) && pathMatches(c.path, path) && (!c.secure || isHttps),
  );
  if (!matching.length) return null;
  return matching.map((c) => `${c.name}=${c.value}`).join('; ');
}
