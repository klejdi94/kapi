export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 2 : 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatRelativeTime(at: number): string {
  const delta = Date.now() - at;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(at).toLocaleDateString();
}

/** Groups history the way a person thinks about it. */
export function dayBucket(at: number): string {
  const now = new Date();
  const then = new Date(at);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= startOfToday) return 'Today';
  if (at >= startOfToday - 86_400_000) return 'Yesterday';
  if (at >= startOfToday - 7 * 86_400_000) return 'This week';
  return then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function statusTone(status: number): 'ok' | 'info' | 'warn' | 'danger' | 'dim' {
  if (status >= 200 && status < 300) return 'ok';
  if (status >= 300 && status < 400) return 'info';
  if (status >= 400 && status < 500) return 'warn';
  if (status >= 500) return 'danger';
  return 'dim';
}

const STATUS_TEXT: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted',
  203: 'Non-Authoritative Information', 204: 'No Content', 205: 'Reset Content', 206: 'Partial Content',
  300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified',
  307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized',
  402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  406: 'Not Acceptable', 407: 'Proxy Authentication Required', 408: 'Request Timeout', 409: 'Conflict',
  410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large',
  414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable',
  417: 'Expectation Failed', 418: "I'm a teapot", 422: 'Unprocessable Entity', 425: 'Too Early',
  426: 'Upgrade Required', 428: 'Precondition Required', 429: 'Too Many Requests',
  431: 'Request Header Fields Too Large', 451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable',
  504: 'Gateway Timeout', 505: 'HTTP Version Not Supported', 507: 'Insufficient Storage',
  511: 'Network Authentication Required',
};

export function statusText(status: number, provided?: string): string {
  return provided || STATUS_TEXT[status] || '';
}

/* --------------------------------------------------------- content types */

export function mimeOf(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

export function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType);
  return (match?.[1] || 'utf-8').toLowerCase();
}

export type BodyLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'css' | 'text' | 'binary';

export function languageFor(contentType: string, sample = ''): BodyLanguage {
  const mime = mimeOf(contentType);
  if (/^application\/(.*\+)?json$/.test(mime) || mime === 'text/json' || mime.endsWith('+json')) return 'json';
  if (mime === 'application/x-ndjson' || mime === 'application/jsonl') return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (/xml/.test(mime)) return 'xml';
  if (/(javascript|ecmascript)/.test(mime)) return 'javascript';
  if (mime === 'text/css') return 'css';
  if (mime.startsWith('text/')) return 'text';
  if (isBinaryMime(mime)) return 'binary';
  // Servers lie about content-type constantly; fall back to sniffing the body.
  const head = sample.trimStart().slice(0, 1);
  if (head === '{' || head === '[') return 'json';
  if (head === '<') return /^<\?xml/i.test(sample.trimStart()) ? 'xml' : 'html';
  return 'text';
}

export function isBinaryMime(mime: string): boolean {
  if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/') || mime.startsWith('font/')) return true;
  return [
    'application/pdf', 'application/zip', 'application/gzip', 'application/x-tar',
    'application/octet-stream', 'application/wasm', 'application/x-7z-compressed',
    'application/vnd.ms-excel', 'application/x-protobuf', 'application/grpc',
  ].includes(mime);
}

export function previewKind(mime: string): 'html' | 'image' | 'audio' | 'video' | 'pdf' | 'none' {
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return 'none';
}

export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'application/json': 'json', 'text/html': 'html', 'text/plain': 'txt', 'text/css': 'css',
    'application/xml': 'xml', 'text/xml': 'xml', 'image/png': 'png', 'image/jpeg': 'jpg',
    'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'application/pdf': 'pdf',
    'application/zip': 'zip', 'text/csv': 'csv', 'application/javascript': 'js',
  };
  if (map[mime]) return map[mime];
  if (mime.endsWith('+json')) return 'json';
  if (mime.endsWith('+xml')) return 'xml';
  const tail = mime.split('/')[1];
  return tail ? tail.replace(/[^a-z0-9]+/gi, '') || 'bin' : 'bin';
}

/* ------------------------------------------------------------ formatting */

export function prettyJson(text: string, indent = 2): { text: string; error: string | null; position?: number } {
  try {
    return { text: JSON.stringify(JSON.parse(text), null, indent), error: null };
  } catch (err) {
    const message = (err as Error).message;
    const at = /position (\d+)/.exec(message);
    return { text, error: message, position: at ? Number(at[1]) : undefined };
  }
}

/** Small hand-rolled XML/HTML indenter — avoids pulling in a parser for cosmetics. */
export function prettyXml(text: string, indent = 2): string {
  const pad = ' '.repeat(indent);
  const normalized = text.replace(/>\s*</g, '><').trim();
  const tokens = normalized.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n');
  let depth = 0;
  const out: string[] = [];
  for (const token of tokens) {
    if (/^<\/\w/.test(token)) depth = Math.max(0, depth - 1);
    out.push(pad.repeat(depth) + token);
    const opens = /^<\w[^>]*[^/]>$/.test(token) && !/^<(\?|!)/.test(token);
    if (opens) depth += 1;
  }
  return out.join('\n');
}

export function beautify(text: string, language: BodyLanguage): string {
  if (language === 'json') {
    const result = prettyJson(text);
    return result.error ? text : result.text;
  }
  if (language === 'xml' || language === 'html') return prettyXml(text);
  return text;
}

export function minifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/* --------------------------------------------------------------- cookies */

export interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: string;
  maxAge: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  raw: string;
}

export function parseSetCookie(raw: string): ParsedCookie {
  const parts = raw.split(';');
  const [namePart, ...rest] = parts;
  const eq = namePart.indexOf('=');
  const cookie: ParsedCookie = {
    name: eq === -1 ? namePart.trim() : namePart.slice(0, eq).trim(),
    value: eq === -1 ? '' : namePart.slice(eq + 1).trim(),
    domain: '', path: '', expires: '', maxAge: '',
    httpOnly: false, secure: false, sameSite: '', raw,
  };
  for (const attr of rest) {
    const idx = attr.indexOf('=');
    const key = (idx === -1 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const value = idx === -1 ? '' : attr.slice(idx + 1).trim();
    if (key === 'domain') cookie.domain = value;
    else if (key === 'path') cookie.path = value;
    else if (key === 'expires') cookie.expires = value;
    else if (key === 'max-age') cookie.maxAge = value;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite') cookie.sameSite = value;
  }
  return cookie;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Common MIME types offered as a quick-pick when a header value is Content-Type. */
export const COMMON_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'text/css',
  'text/csv',
  'text/xml',
  'application/javascript',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/graphql',
  'application/ld+json',
  'application/vnd.api+json',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
];
