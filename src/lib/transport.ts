import type { KapiError, KapiErrorKind } from '@/types';

export interface PreparedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  payload: BodyInit | null;
  followRedirects: boolean;
  timeoutMs: number;
}

export interface RawResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  blob: Blob;
  finalUrl: string;
  redirected: boolean;
  ttfb: number;
  total: number;
}

/** Thrown by `run` so `send` can classify failures uniformly. */
export class TransportError extends Error {
  kind: KapiErrorKind;
  detail: string;

  constructor(args: { kind: KapiErrorKind; title: string; detail: string }) {
    super(args.title);
    this.name = 'TransportError';
    this.kind = args.kind;
    this.detail = args.detail;
  }
}

function headersToList(headers: Headers): [string, string][] {
  const list: [string, string][] = [];
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
  headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie' && cookies.length) return;
    list.push([name, value]);
  });
  for (const cookie of cookies) list.push(['set-cookie', cookie]);
  return list;
}

/**
 * True inside the Tauri shell. Kept as a runtime check (not a build-time flag)
 * so the same bundle keeps working as a plain page during `npm run dev` — it
 * just won't be able to reach cross-origin APIs without a CORS-friendly
 * server, since there is no proxy to fall back to anymore.
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Runs a request. Inside the Tauri shell this calls the native HTTP client
 * (via `@tauri-apps/plugin-http`), which makes the request from the Rust
 * process — no browser, no CORS, no Origin header, so literally any API
 * reachable from this machine works exactly like it would from curl or
 * Postman. Outside Tauri it falls back to the page's own `fetch`, which is
 * still subject to normal browser CORS rules.
 */
export async function run(prepared: PreparedRequest, signal: AbortSignal): Promise<RawResponse> {
  const started = performance.now();
  const doFetch = isDesktop() ? (await import('@tauri-apps/plugin-http')).fetch : fetch;

  let response: Response;
  try {
    response = await doFetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.payload,
      redirect: prepared.followRedirects ? 'follow' : 'manual',
      signal,
      ...(isDesktop() ? { connectTimeout: prepared.timeoutMs, maxRedirections: prepared.followRedirects ? 20 : 0 } : {}),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    if (e.name === 'AbortError') {
      throw new TransportError({ kind: 'aborted', title: 'Request cancelled', detail: 'The request was stopped before a response arrived.' });
    }

    const message = e.cause?.message || e.message || String(err);
    if (!isDesktop()) {
      // Running as a plain page: the browser hides the real cause of a
      // cross-origin failure behind a bare TypeError, same as it always has.
      throw new TransportError({
        kind: 'blocked',
        title: 'The browser blocked this request',
        detail:
          `Sending "${prepared.url}" failed. Outside the kapi desktop app, this almost always means the server ` +
          'did not return an Access-Control-Allow-Origin header for a cross-origin call. Run kapi as a desktop ' +
          'app (npm run desktop:dev) to reach any API regardless of CORS.',
      });
    }
    if (/dns|resolve|lookup/i.test(message)) {
      throw new TransportError({ kind: 'dns', title: 'Could not resolve host', detail: message });
    }
    if (/refused/i.test(message)) {
      throw new TransportError({ kind: 'refused', title: 'Connection refused', detail: message });
    }
    if (/certificate|tls|ssl/i.test(message)) {
      throw new TransportError({ kind: 'tls', title: 'TLS handshake failed', detail: message });
    }
    if (/timed? ?out/i.test(message)) {
      throw new TransportError({ kind: 'timeout', title: 'The request timed out', detail: message });
    }
    throw new TransportError({ kind: 'unknown', title: 'Request failed', detail: message });
  }

  if (response.type === 'opaqueredirect') {
    throw new TransportError({
      kind: 'unknown',
      title: 'Redirect not readable',
      detail: 'The server answered with a redirect that could not be exposed with redirects set to manual.',
    });
  }

  const ttfb = performance.now() - started;
  const blob = await response.blob();
  return {
    status: response.status,
    statusText: response.statusText,
    headers: headersToList(response.headers),
    blob,
    finalUrl: response.url || prepared.url,
    redirected: response.redirected,
    ttfb,
    total: performance.now() - started,
  };
}

export function toKapiError(err: unknown, elapsed: number): KapiError {
  if (err instanceof TransportError) {
    return { kind: err.kind, title: err.message, detail: err.detail, elapsed };
  }
  const e = err as Error;
  return { kind: 'unknown', title: 'Something went wrong', detail: e?.message || String(err), elapsed };
}
