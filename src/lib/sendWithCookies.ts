import type { RequestDef, RunResult } from '@/types';
import type { VarScope } from './variables';
import { send, type SendOptions } from './send';
import { withCookieJar } from './cookieSend';
import { useWorkspaces, activeWorkspace } from '@/store/workspaces';

/**
 * `send()` with the active workspace's cookie jar (see cookieSend.ts) — used
 * everywhere the app fires a real request, so cookies behave the same from a
 * manual send, the collection runner, or a script's `pm.sendRequest`.
 */
const workspaceSend = withCookieJar<SendOptions>(
  {
    get: () => activeWorkspace(useWorkspaces.getState()).cookies ?? [],
    add: (cookies) => useWorkspaces.getState().addCookies(cookies),
  },
  send,
);

export function sendWithCookies(request: RequestDef, scope: VarScope, options: SendOptions = {}): Promise<RunResult> {
  return workspaceSend(request, scope, options);
}
