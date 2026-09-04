import { emptyAuth, emptyBody, kv, newRequest, withTrailingBlank } from '@/lib/factory';
import type { HttpMethod, RequestDef } from '@/types';
import { CONTENT_TYPES } from '@/lib/body';

/** Tokenizes a shell-ish command line: handles quotes, escapes, and line continuations. */
function tokenize(input: string): string[] {
  const normalized = input.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let i = 0;
  while (i < normalized.length) {
    while (i < normalized.length && /\s/.test(normalized[i])) i++;
    if (i >= normalized.length) break;
    let token = '';
    let quote: '"' | "'" | null = null;
    while (i < normalized.length) {
      const ch = normalized[i];
      if (quote) {
        if (ch === quote) {
          quote = null;
          i++;
          continue;
        }
        if (quote === '"' && ch === '\\' && '"\\$`'.includes(normalized[i + 1] ?? '')) {
          token += normalized[i + 1];
          i += 2;
          continue;
        }
        token += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        i++;
        continue;
      }
      if (/\s/.test(ch)) break;
      if (ch === '\\') {
        token += normalized[i + 1] ?? '';
        i += 2;
        continue;
      }
      token += ch;
      i++;
    }
    tokens.push(token);
  }
  return tokens;
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl\s/i.test(text.trim());
}

/** Parses a `curl` command into a request. Covers the flags people actually paste. */
export function parseCurl(input: string): RequestDef | null {
  if (!looksLikeCurl(input)) return null;
  const tokens = tokenize(input).slice(1); // drop "curl"

  let url = '';
  let method: HttpMethod | null = null;
  const headers: [string, string][] = [];
  let dataParts: string[] = [];
  let dataMode: 'raw' | 'urlencoded-parts' | 'form' | 'binary' | null = null;
  let user: string | null = null;
  let compressed = false;
  let insecure = false;

  const next = (i: number) => tokens[i + 1];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-X' || t === '--request') {
      method = next(i)?.toUpperCase() as HttpMethod;
      i++;
    } else if (t === '-H' || t === '--header') {
      const raw = next(i) ?? '';
      const idx = raw.indexOf(':');
      if (idx !== -1) headers.push([raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()]);
      i++;
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii') {
      dataParts.push(next(i) ?? '');
      dataMode = dataMode ?? 'raw';
      i++;
    } else if (t === '--data-urlencode') {
      dataParts.push(next(i) ?? '');
      dataMode = 'urlencoded-parts';
      i++;
    } else if (t === '-F' || t === '--form') {
      dataParts.push(next(i) ?? '');
      dataMode = 'form';
      i++;
    } else if (t === '-u' || t === '--user') {
      user = next(i) ?? '';
      i++;
    } else if (t === '-A' || t === '--user-agent') {
      headers.push(['User-Agent', next(i) ?? '']);
      i++;
    } else if (t === '-b' || t === '--cookie') {
      headers.push(['Cookie', next(i) ?? '']);
      i++;
    } else if (t === '-e' || t === '--referer') {
      headers.push(['Referer', next(i) ?? '']);
      i++;
    } else if (t === '--compressed') {
      compressed = true;
    } else if (t === '-k' || t === '--insecure') {
      insecure = true;
    } else if (t === '-G' || t === '--get') {
      method = method ?? 'GET';
    } else if (t === '-I' || t === '--head') {
      method = 'HEAD';
    } else if (t === '-L' || t === '--location' || t === '-s' || t === '--silent' || t === '-v' || t === '--verbose' || t === '-i' || t === '--include') {
      // flags with no request-shape effect
    } else if (t === '--url') {
      url = next(i) ?? '';
      i++;
    } else if (!t.startsWith('-') && !url) {
      url = t;
    }
  }

  if (!url) return null;
  void compressed;
  void insecure;

  const request = newRequest({ url, method: method || (dataParts.length ? 'POST' : 'GET'), auth: emptyAuth('none') });
  request.headers = withTrailingBlank(headers.map(([key, value]) => kv({ key, value })));

  const headerNames = headers.map(([k]) => k.toLowerCase());

  if (user) {
    const [username, password = ''] = user.split(':');
    request.auth = { ...emptyAuth('basic'), type: 'basic', basic: { username, password } };
  }

  if (dataMode === 'form') {
    request.body = { ...emptyBody(), mode: 'form-data' };
    request.body.formData = withTrailingBlank(
      dataParts.map((part) => {
        const idx = part.indexOf('=');
        const key = idx === -1 ? part : part.slice(0, idx);
        const value = idx === -1 ? '' : part.slice(idx + 1);
        const isFile = value.startsWith('@');
        return kv({ key, value: isFile ? '' : value, kind: isFile ? 'file' : 'text', fileName: isFile ? value.slice(1) : undefined });
      }),
    );
  } else if (dataMode === 'urlencoded-parts') {
    request.body = { ...emptyBody(), mode: 'urlencoded' };
    request.body.urlencoded = withTrailingBlank(
      dataParts.map((part) => {
        const idx = part.indexOf('=');
        return idx === -1 ? kv({ key: part, value: '' }) : kv({ key: part.slice(0, idx), value: part.slice(idx + 1) });
      }),
    );
  } else if (dataParts.length) {
    const joined = dataParts.join('&');
    const declaredType = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
    if (declaredType.includes('json') || /^\s*[[{]/.test(joined)) {
      request.body = { ...emptyBody(), mode: 'json' };
      request.body.text.json = joined;
      if (!headerNames.includes('content-type')) headers.push(['Content-Type', CONTENT_TYPES.json]);
    } else if (declaredType.includes('x-www-form-urlencoded') || (!declaredType && /^[^=]+=[^&]*(&[^=]+=[^&]*)*$/.test(joined))) {
      request.body = { ...emptyBody(), mode: 'urlencoded' };
      request.body.urlencoded = withTrailingBlank(
        joined.split('&').filter(Boolean).map((pair) => {
          const idx = pair.indexOf('=');
          return idx === -1
            ? kv({ key: decodeURIComponent(pair), value: '' })
            : kv({ key: decodeURIComponent(pair.slice(0, idx)), value: decodeURIComponent(pair.slice(idx + 1)) });
        }),
      );
    } else {
      request.body = { ...emptyBody(), mode: 'text' };
      request.body.text.text = joined;
    }
  }

  return request;
}
