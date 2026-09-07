import type { KapiError, KapiErrorKind } from '@/types';
import { SseParser, type SseEvent } from './sse';

export interface PreparedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  payload: BodyInit | null;
  followRedirects: boolean;
  timeoutMs: number;
  /** `http://` or `socks5://` — desktop only, no effect running as a plain page. */
  proxyUrl?: string;
  insecureSkipTlsVerify?: boolean;
  /** Present together, these route the request through a dedicated client (see `runViaMtls`) instead of the normal fetch path. */
  clientCertPem?: string;
  clientKeyPem?: string;
  caCertPem?: string;
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
 * Reads a `text/event-stream` body incrementally, firing `onSseEvent` for
 * each event as it arrives rather than waiting for the connection to close
 * (which, for a live feed or a streaming completion, may never happen on
 * its own). The raw bytes are also kept and reassembled into the returned
 * blob, so everything downstream — size, the Raw/Pretty views, saving as an
 * example — sees the same complete body it would have from a buffered read.
 */
async function readSseStream(body: ReadableStream<Uint8Array>, contentType: string, signal: AbortSignal, onSseEvent: (event: SseEvent) => void): Promise<Blob> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const chunks: Uint8Array[] = [];

  const onAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onSseEvent(event);
    }
  } catch (err) {
    if (signal.aborted) {
      throw new TransportError({ kind: 'aborted', title: 'Request cancelled', detail: 'The stream was stopped before it finished.' });
    }
    throw new TransportError({ kind: 'unknown', title: 'Reading the stream failed', detail: (err as Error).message || String(err) });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  return new Blob(chunks as BlobPart[], { type: contentType });
}

/** A body kapi can hand to the Rust-side mTLS client as raw bytes. Multipart form-data goes through `formDataToParts` instead, so file uploads still work over this path. */
async function payloadToBytes(payload: BodyInit | null): Promise<number[] | null> {
  if (payload == null) return null;
  if (typeof payload === 'string') return Array.from(new TextEncoder().encode(payload));
  if (payload instanceof Uint8Array) return Array.from(payload);
  if (payload instanceof ArrayBuffer) return Array.from(new Uint8Array(payload));
  if (payload instanceof URLSearchParams) return Array.from(new TextEncoder().encode(payload.toString()));
  if (payload instanceof Blob) return Array.from(new Uint8Array(await payload.arrayBuffer()));
  throw new TransportError({ kind: 'invalid', title: 'This body type needs a plain request', detail: 'This body type is not supported over the client-certificate (mTLS) path.' });
}

interface MultipartField {
  name: string;
  kind: 'text' | 'file';
  value?: string;
  fileBytes?: number[];
  fileName?: string;
  contentType?: string;
}

/** Reads every field of a form-data body into plain data the Rust side can rebuild as a real multipart body — including actual file bytes, so uploads work over the mTLS path too. */
async function formDataToParts(form: FormData): Promise<MultipartField[]> {
  const parts: MultipartField[] = [];
  for (const [name, value] of form.entries()) {
    if (value instanceof File) {
      parts.push({ name, kind: 'file', fileBytes: Array.from(new Uint8Array(await value.arrayBuffer())), fileName: value.name, contentType: value.type || 'application/octet-stream' });
    } else {
      parts.push({ name, kind: 'text', value: String(value) });
    }
  }
  return parts;
}

/**
 * The one case plugin-http's `fetch()` can't do: presenting a client
 * certificate. Goes through a dedicated Rust command (`kapi_send_mtls`,
 * built on `reqwest` directly) instead of the normal path — see
 * `src-tauri/src/mtls.rs` for why. Desktop-only; there's no browser
 * equivalent to fall back to.
 */
async function runViaMtls(prepared: PreparedRequest, signal: AbortSignal): Promise<RawResponse> {
  if (!isDesktop()) {
    throw new TransportError({ kind: 'invalid', title: 'Client certificates need the desktop app', detail: 'Run kapi as a desktop app to send a request with a client certificate.' });
  }
  const started = performance.now();
  const { invoke } = await import('@tauri-apps/api/core');
  const isMultipart = prepared.payload instanceof FormData;
  const body = isMultipart ? null : await payloadToBytes(prepared.payload);
  const multipart = isMultipart ? await formDataToParts(prepared.payload as FormData) : null;

  let result: { status: number; status_text: string; headers: [string, string][]; body: number[]; final_url: string };
  try {
    result = await invoke('kapi_send_mtls', {
      req: {
        method: prepared.method,
        url: prepared.url,
        headers: prepared.headers,
        body,
        multipart,
        timeout_ms: prepared.timeoutMs,
        follow_redirects: prepared.followRedirects,
        client_cert_pem: prepared.clientCertPem,
        client_key_pem: prepared.clientKeyPem,
        ca_cert_pem: prepared.caCertPem || null,
        accept_invalid_certs: !!prepared.insecureSkipTlsVerify,
        accept_invalid_hostnames: !!prepared.insecureSkipTlsVerify,
        proxy_url: prepared.proxyUrl || null,
      },
    });
  } catch (err) {
    if (signal.aborted) throw new TransportError({ kind: 'aborted', title: 'Request cancelled', detail: 'The request was stopped before a response arrived.' });
    const message = String(err);
    if (/certificate|tls|ssl/i.test(message)) throw new TransportError({ kind: 'tls', title: 'TLS handshake failed', detail: message });
    if (/timed? ?out/i.test(message)) throw new TransportError({ kind: 'timeout', title: 'The request timed out', detail: message });
    throw new TransportError({ kind: 'unknown', title: 'Request failed', detail: message });
  }

  const total = performance.now() - started;
  return {
    status: result.status,
    statusText: result.status_text,
    headers: result.headers,
    blob: new Blob([new Uint8Array(result.body) as BlobPart]),
    finalUrl: result.final_url || prepared.url,
    redirected: result.final_url !== prepared.url,
    ttfb: total,
    total,
  };
}

/**
 * Runs a request. Inside the Tauri shell this calls the native HTTP client
 * (via `@tauri-apps/plugin-http`), which makes the request from the Rust
 * process — no browser, no CORS, no Origin header, so literally any API
 * reachable from this machine works exactly like it would from curl or
 * Postman. Outside Tauri it falls back to the page's own `fetch`, which is
 * still subject to normal browser CORS rules.
 */
export async function run(prepared: PreparedRequest, signal: AbortSignal, onSseEvent?: (event: SseEvent) => void): Promise<RawResponse> {
  if (prepared.clientCertPem && prepared.clientKeyPem) return runViaMtls(prepared, signal);

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
      ...(isDesktop()
        ? {
            connectTimeout: prepared.timeoutMs,
            maxRedirections: prepared.followRedirects ? 20 : 0,
            ...(prepared.proxyUrl ? { proxy: { all: prepared.proxyUrl } } : {}),
            ...(prepared.insecureSkipTlsVerify ? { danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true } } : {}),
          }
        : {}),
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
  const contentType = response.headers.get('content-type') || '';
  const blob =
    onSseEvent && /^text\/event-stream/i.test(contentType) && response.body
      ? await readSseStream(response.body, contentType, signal, onSseEvent)
      : await response.blob();
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
