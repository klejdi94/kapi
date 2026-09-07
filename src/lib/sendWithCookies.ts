import type { RequestDef, RunResult } from '@/types';
import type { VarScope } from './variables';
import { resolve } from './variables';
import { send, type SendOptions } from './send';
import { kv } from './factory';
import { cookieHeaderFor, cookiesFromSetHeaders } from './cookieJar';
import { useWorkspaces, activeWorkspace } from '@/store/workspaces';

/**
 * Wraps `send()` with a per-workspace cookie jar: attaches any cookies that
 * match the request's host/path/scheme (unless the user already set their
 * own `Cookie` header), then stores whatever the response's `Set-Cookie`
 * headers say — the same behaviour a browser tab gives you for free, so a
 * login request's session cookie actually reaches the calls after it.
 * Used everywhere `send()` is, so cookies work the same from a manual send,
 * the collection runner, or anywhere else that fires a real request.
 */
export async function sendWithCookies(request: RequestDef, scope: VarScope, options: SendOptions = {}): Promise<RunResult> {
  const workspace = activeWorkspace(useWorkspaces.getState());
  const resolvedUrl = resolve(request.url, scope);
  const cookieHeader = cookieHeaderFor(workspace.cookies ?? [], resolvedUrl);
  const hasUserCookie = request.headers.some((h) => h.enabled && h.key.trim().toLowerCase() === 'cookie');

  const requestToSend = cookieHeader && !hasUserCookie ? { ...request, headers: [...request.headers, kv({ key: 'Cookie', value: cookieHeader })] } : request;

  const result = await send(requestToSend, scope, options);

  if (result.ok) {
    const setCookieHeaders = result.response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
    if (setCookieHeaders.length) {
      const incoming = cookiesFromSetHeaders(result.response.finalUrl || resolvedUrl, setCookieHeaders);
      if (incoming.length) useWorkspaces.getState().addCookies(incoming);
    }
  }

  return result;
}
