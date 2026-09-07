import type { KapiError, RequestDef, SentRequest } from '@/types';

const BODY_LIMIT = 3000;

function clip(text: string): string {
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n… (truncated)` : text;
}

function headerLines(headers: [string, string][]): string {
  return headers.length ? headers.map(([k, v]) => `  ${k}: ${v}`).join('\n') : '  (none)';
}

export interface AiResponseContext {
  status: number;
  statusText: string;
  headers: [string, string][];
  text: string;
  binary: boolean;
  timeMs: number;
  sent: SentRequest;
}

export interface AiErrorContext {
  error: KapiError;
}

export interface AiContextInput {
  request?: RequestDef;
  response?: AiResponseContext;
  error?: AiErrorContext;
}

/**
 * Renders what's currently open in kapi as plain text, prepended to the
 * prompt sent to Claude. Values are exactly what the request/response
 * already show on screen (the same data the Console and code generator
 * expose) — nothing extra is resolved or fetched for this.
 */
export function describeAiContext(ctx: AiContextInput, secrets?: string[]): string {
  const parts: string[] = [];

  if (ctx.request) {
    const r = ctx.request;
    const enabledHeaders = r.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [h.key, h.value] as [string, string]);
    parts.push(
      [`Request open in kapi:`, `${r.method} ${r.url}`, `Headers:`, headerLines(enabledHeaders)].join('\n'),
    );
  }

  if (ctx.response) {
    const res = ctx.response;
    parts.push(
      [
        `Response received:`,
        `${res.sent.method} ${res.sent.url}`,
        `Status: ${res.status} ${res.statusText} · ${Math.round(res.timeMs)}ms`,
        `Response headers:`,
        headerLines(res.headers),
        `Response body:`,
        res.binary ? '(binary body)' : clip(res.text) || '(empty body)',
      ].join('\n'),
    );
  }

  if (ctx.error) {
    const e = ctx.error.error;
    parts.push([`Request failed:`, `${e.title} (${e.kind}) after ${Math.round(e.elapsed)}ms`, e.detail].join('\n'));
  }

  const rendered = parts.join('\n\n');
  return secrets?.length ? redactSecrets(rendered, secrets) : rendered;
}

/** Blanks out any literal occurrence of a secret variable's value — catches it wherever it ended up (URL, header, body), not just where it was substituted from. */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const value of secrets) {
    if (!value) continue;
    out = out.split(value).join('<secret>');
  }
  return out;
}
