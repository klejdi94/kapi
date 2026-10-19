import type { RequestDef, RunResult, StoredCookie } from '@/types';
import { resolve, type VarScope } from './variables';
import { kv } from './factory';
import { cookieHeaderFor, cookiesFromSetHeaders, mergeCookies } from './cookieJar';

export interface CookieJar {
  get(): StoredCookie[];
  add(cookies: StoredCookie[]): void;
}

/**
 * Wraps a send function with a cookie jar: attaches the cookies that match the
 * request's host/path/scheme (unless the request sets its own `Cookie`
 * header), then stores whatever the response's `Set-Cookie` headers say —
 * what a browser tab does for free, so a login's session cookie reaches the
 * calls after it. The app backs the jar with the workspace; the CLI with
 * memory (one jar per run, or per virtual user in a load test).
 */
export function withCookieJar<O>(
  jar: CookieJar,
  sendFn: (request: RequestDef, scope: VarScope, options?: O) => Promise<RunResult>,
): (request: RequestDef, scope: VarScope, options?: O) => Promise<RunResult> {
  return async (request, scope, options) => {
    const resolvedUrl = resolve(request.url, scope);
    const cookieHeader = cookieHeaderFor(jar.get(), resolvedUrl);
    const hasUserCookie = request.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === 'cookie');
    const requestToSend = cookieHeader && !hasUserCookie ? { ...request, headers: [...request.headers, kv({ key: 'Cookie', value: cookieHeader })] } : request;

    const result = await sendFn(requestToSend, scope, options);

    if (result.ok) {
      const setCookieHeaders = result.response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
      if (setCookieHeaders.length) {
        const incoming = cookiesFromSetHeaders(result.response.finalUrl || resolvedUrl, setCookieHeaders);
        if (incoming.length) jar.add(incoming);
      }
    }
    return result;
  };
}

/** A jar that lives only as long as the object — the CLI's, and each load-test virtual user's. */
export function memoryCookieJar(initial: StoredCookie[] = []): CookieJar & { cookies: StoredCookie[] } {
  const jar = {
    cookies: initial,
    get: () => jar.cookies,
    add: (incoming: StoredCookie[]) => {
      jar.cookies = mergeCookies(jar.cookies, incoming);
    },
  };
  return jar;
}
