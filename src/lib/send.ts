import type { KapiResponse, RequestDef, RunResult, SentRequest } from '@/types';
import { applyAuth, authStrings } from './auth';
import { bodyStrings, buildBody } from './body';
import { uid } from './factory';
import { charsetOf, isBinaryMime, mimeOf } from './format';
import { collectUsages, missingNames, resolve, type VarScope } from './variables';
import { run, toKapiError, type PreparedRequest } from './transport';

export interface PreparedSend {
  prepared: PreparedRequest;
  sent: SentRequest;
  /** Non-fatal problems worth telling the user about before they hit send. */
  warnings: string[];
}

/** `:id` style placeholders, ignoring the `://` in the scheme. */
export function pathVariableNames(url: string): string[] {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutQuery = withoutScheme.split(/[?#]/)[0];
  const names: string[] = [];
  for (const match of withoutQuery.matchAll(/:([A-Za-z_][A-Za-z0-9_-]*)/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/** Adds a scheme so `httpbin.org/get` behaves the way people expect it to. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost([:/]|$)/i.test(trimmed) || /^127\.0\.0\.1([:/]|$)/.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

/** Splits a URL into the part before the query and its raw query string. */
export function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  if (queryAt === -1) return { base: withoutHash, query: '', hash };
  return { base: withoutHash.slice(0, queryAt), query: withoutHash.slice(queryAt + 1), hash };
}

export async function prepare(request: RequestDef, scope: VarScope): Promise<PreparedSend> {
  const warnings: string[] = [];

  const { base, hash } = splitUrl(resolve(request.url, scope));
  let url = normalizeUrl(base);

  // Path variables before query, so `:id` inside the path is gone by parse time.
  for (const row of request.pathVars) {
    if (!row.key.trim()) continue;
    const value = resolve(row.value, scope);
    if (!value) warnings.push(`Path variable :${row.key} has no value.`);
    url = url.replace(new RegExp(`:${row.key}(?![A-Za-z0-9_-])`, 'g'), encodeURIComponent(value));
  }

  const auth = await applyAuth(request.auth, scope);
  if (auth.warning) warnings.push(auth.warning);

  // Query: the params grid is authoritative, and auth may contribute to it.
  const search = new URLSearchParams();
  for (const row of [...request.params, ...auth.params]) {
    if (!row.enabled || (!row.key.trim() && !row.value.trim())) continue;
    search.append(resolve(row.key, scope), resolve(row.value, scope));
  }
  const queryString = search.toString();
  const finalUrl = `${url}${queryString ? (url.includes('?') ? '&' : '?') + queryString : ''}${hash}`;

  const built = buildBody(request, scope);
  for (const name of built.missingFiles) {
    warnings.push(`"${name}" is no longer attached — pick the file again to include it.`);
  }

  // Header assembly. The user's own headers always win over generated ones.
  const headers: [string, string][] = [];
  const userHeaderNames = new Set<string>();
  for (const row of request.headers) {
    if (!row.enabled || !row.key.trim()) continue;
    headers.push([resolve(row.key, scope), resolve(row.value, scope)]);
    userHeaderNames.add(row.key.trim().toLowerCase());
  }
  for (const row of auth.headers) {
    if (userHeaderNames.has(row.key.toLowerCase())) continue;
    headers.push([row.key, row.value]);
    userHeaderNames.add(row.key.toLowerCase());
  }
  if (request.settings.autoHeaders) {
    if (built.contentType && !userHeaderNames.has('content-type')) headers.push(['Content-Type', built.contentType]);
    if (!userHeaderNames.has('accept')) headers.push(['Accept', '*/*']);
  }

  const prepared: PreparedRequest = {
    method: request.method.toUpperCase(),
    url: finalUrl,
    headers,
    payload: built.payload,
    followRedirects: request.settings.followRedirects,
    timeoutMs: request.settings.timeoutMs,
  };

  const sent: SentRequest = {
    method: prepared.method,
    url: finalUrl,
    headers,
    bodyText: built.text,
    bodyKind: request.body.mode,
  };

  return { prepared, sent, warnings };
}

/** Variables this request references but cannot resolve. */
export function unresolvedVariables(request: RequestDef, scope: VarScope): string[] {
  const texts = [
    request.url,
    ...request.params.flatMap((r) => (r.enabled ? [r.key, r.value] : [])),
    ...request.headers.flatMap((r) => (r.enabled ? [r.key, r.value] : [])),
    ...request.pathVars.map((r) => r.value),
    ...authStrings(request.auth),
    ...bodyStrings(request.body),
  ];
  return missingNames(collectUsages(texts, scope));
}

async function decodeBody(blob: Blob, contentType: string): Promise<{ text: string; binary: boolean }> {
  const mime = mimeOf(contentType);
  if (isBinaryMime(mime)) return { text: '', binary: true };
  if (blob.size === 0) return { text: '', binary: false };

  const charset = charsetOf(contentType);
  try {
    if (charset === 'utf-8' || charset === 'utf8') {
      const text = await blob.text();
      // A lone replacement char in the first bytes means it wasn't really text.
      if (blob.size > 0 && text.length === 0) return { text: '', binary: true };
      return { text, binary: false };
    }
    const buffer = await blob.arrayBuffer();
    const text = new TextDecoder(charset, { fatal: false }).decode(buffer);
    return { text, binary: false };
  } catch {
    const text = await blob.text().catch(() => '');
    return { text, binary: text.length === 0 && blob.size > 0 };
  }
}

function headerBytes(headers: [string, string][]): number {
  return headers.reduce((sum, [name, value]) => sum + name.length + value.length + 4, 0);
}

export interface SendOptions {
  signal?: AbortSignal;
}

export async function send(request: RequestDef, scope: VarScope, options: SendOptions = {}): Promise<RunResult> {
  const startedAt = performance.now();

  if (!request.url.trim()) {
    return {
      ok: false,
      error: { kind: 'invalid', title: 'No URL', detail: 'Enter a URL before sending the request.', elapsed: 0 },
    };
  }

  let preparedSend: PreparedSend;
  try {
    preparedSend = await prepare(request, scope);
    new URL(preparedSend.prepared.url);
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'invalid',
        title: 'That URL is not valid',
        detail: `${(err as Error).message}. Check the scheme, host and any {{variables}} you used.`,
        elapsed: performance.now() - startedAt,
      },
    };
  }

  const { prepared, sent } = preparedSend;
  const controller = new AbortController();
  const external = options.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, request.settings.timeoutMs));

  try {
    const raw = await run(prepared, controller.signal);
    clearTimeout(timer);

    const contentType =
      raw.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || 'application/octet-stream';
    const { text, binary } = await decodeBody(raw.blob, contentType);

    const response: KapiResponse = {
      id: uid(),
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
      text,
      blob: raw.blob,
      contentType,
      size: { headers: headerBytes(raw.headers), body: raw.blob.size },
      timings: { ttfb: raw.ttfb, total: performance.now() - startedAt },
      finalUrl: raw.finalUrl,
      redirected: raw.redirected,
      binary,
      receivedAt: Date.now(),
      sent,
    };

    return { ok: true, response };
  } catch (err) {
    clearTimeout(timer);
    const elapsed = performance.now() - startedAt;

    if (timedOut) {
      return {
        ok: false,
        error: {
          kind: 'timeout',
          title: 'The request timed out',
          detail: `No response after ${Math.round(request.settings.timeoutMs / 1000)}s. Raise the timeout in the Settings tab if the endpoint is simply slow.`,
          elapsed,
        },
      };
    }

    return { ok: false, error: toKapiError(err, elapsed) };
  }
}
