import type { RequestDef, RunResult } from '@/types';
import type { VarScope } from '../variables';
import { emptyAuth, emptyBody, kv, newRequest } from '../factory';
import type { SandboxRequest, SandboxResponse, SandboxSend } from './sandbox';

/**
 * Turns a script's `pm.sendRequest(...)` into an ordinary kapi send, so it
 * goes through the same transport (native HTTP in the app, Node in the CLI),
 * proxy and TLS settings as any other request — never through a path the
 * script controls. `{{variables}}` in it resolve against the current scope.
 */
export function makeScriptSender(
  sendFn: (request: RequestDef, scope: VarScope) => Promise<RunResult>,
  scope: VarScope,
  template?: Pick<RequestDef, 'settings'>,
): SandboxSend {
  return async (req: SandboxRequest): Promise<SandboxResponse> => {
    const request = toRequestDef(req, template);
    const result = await sendFn(request, scope);
    if (!result.ok) throw new Error(`${result.error.title}${result.error.detail ? ` — ${result.error.detail}` : ''}`);
    return {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: result.response.headers,
      text: result.response.binary ? '' : result.response.text,
      timeMs: result.response.timings.total,
    };
  };
}

export function toRequestDef(req: SandboxRequest, template?: Pick<RequestDef, 'settings'>): RequestDef {
  const body = emptyBody();
  if (req.body) {
    body.mode = 'text';
    body.text.text = req.body;
  }
  return newRequest({
    method: req.method,
    url: req.url,
    params: [],
    headers: req.headers.map(([key, value]) => kv({ key, value })),
    auth: emptyAuth('none'),
    body,
    ...(template ? { settings: { ...template.settings } } : {}),
  });
}
