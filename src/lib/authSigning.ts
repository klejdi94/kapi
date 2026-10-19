/**
 * Request signing that depends on the final, fully built request — AWS
 * Signature Version 4 — and challenge/response auth that depends on the
 * server's first reply — HTTP Digest (RFC 7616). Both run on WebCrypto
 * (plus a small MD5, which WebCrypto doesn't offer), so the same code works
 * in the app and in the headless CLI.
 */

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

/* --------------------------------------------------------------- SigV4 */

export interface AwsSigV4Input {
  method: string;
  url: string;
  headers: [string, string][];
  /** The exact body bytes, or `null` for no body. `'unsigned'` when they can't be known up front (multipart). */
  body: Uint8Array | null | 'unsigned';
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  /** For tests; defaults to now. */
  date?: Date;
}

/** RFC 3986 encoding, which is what SigV4 means by "URI-encode" (encodeURIComponent leaves !'()* alone). */
function uriEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The URL's pathname is already percent-encoded once. S3 signs the path
 * encoded exactly once (so: decode, then RFC 3986-encode); every other service
 * normalises `.`/`..` and signs it encoded twice (so: encode the encoded form
 * again), matching what the AWS SDKs send.
 */
function canonicalPath(pathname: string, service: string): string {
  const raw = pathname || '/';
  if (service === 's3') return raw.split('/').map((segment) => uriEncode(decodeURIComponentSafe(segment))).join('/');
  const segments: string[] = [];
  for (const segment of raw.split('/').slice(1)) {
    if (segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  // Collapse empty segments from `//`, but keep a trailing slash.
  const trailing = raw.length > 1 && raw.endsWith('/');
  const kept = segments.filter((segment, i) => segment !== '' || (trailing && i === segments.length - 1));
  return '/' + kept.map(uriEncode).join('/');
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function canonicalQuery(search: string): string {
  const pairs: [string, string][] = [];
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponentSafe((eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const value = eq === -1 ? '' : decodeURIComponentSafe(part.slice(eq + 1).replace(/\+/g, ' '));
    pairs.push([uriEncode(key), uriEncode(value)]);
  }
  pairs.sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function amzDate(date: Date): { stamp: string; day: string } {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, day: stamp.slice(0, 8) };
}

/**
 * Returns the headers to add (Authorization, X-Amz-Date, and X-Amz-Security-Token /
 * X-Amz-Content-Sha256 when they apply). Signs `host`, `content-type` and every
 * `x-amz-*` header — the ones a proxy or the HTTP stack won't rewrite.
 */
export async function signAwsV4(input: AwsSigV4Input): Promise<[string, string][]> {
  const url = new URL(input.url);
  const service = input.service.trim().toLowerCase();
  const region = input.region.trim();
  const { stamp, day } = amzDate(input.date ?? new Date());
  const payloadHash = input.body === 'unsigned' ? 'UNSIGNED-PAYLOAD' : await sha256Hex(input.body ?? new Uint8Array());

  const added: [string, string][] = [['X-Amz-Date', stamp]];
  if (input.sessionToken) added.push(['X-Amz-Security-Token', input.sessionToken]);
  if (service === 's3') added.push(['X-Amz-Content-Sha256', payloadHash]);

  const signable = new Map<string, string[]>();
  const host = url.host;
  signable.set('host', [host]);
  for (const [name, value] of [...input.headers, ...added]) {
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'authorization') continue;
    if (lower !== 'content-type' && !lower.startsWith('x-amz-')) continue;
    const list = signable.get(lower) ?? [];
    list.push(value.trim().replace(/\s+/g, ' '));
    signable.set(lower, list);
  }
  const names = [...signable.keys()].sort();
  const canonicalHeaders = names.map((name) => `${name}:${signable.get(name)!.join(',')}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname, service),
    canonicalQuery(url.search),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(encoder.encode(`AWS4${input.secretKey}`), day);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  added.push(['Authorization', `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`]);
  return added;
}

/* -------------------------------------------------------------- Digest */

/** MD5 (RFC 1321). Only for HTTP Digest, which still commonly requires it. */
export function md5Hex(text: string): string {
  const bytes = encoder.encode(text);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] |= 0x80 << bitLength % 32;
  words[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const total = (((bitLength + 64) >>> 9) << 4) + 16;
  for (let chunk = 0; chunk < total; chunk += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const shift = S[(i >> 4) * 4 + (i % 4)];
      const sum = (a + f + K[i] + (words[chunk + g] | 0)) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  let out = '';
  for (const word of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return out;
}

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string[];
  opaque?: string;
  algorithm: string;
  userhash?: boolean;
}

/** Parses the Digest challenge out of a `WWW-Authenticate` header (which may also list other schemes). */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const start = header.search(/\bDigest\s/i);
  if (start === -1) return null;
  const params: Record<string, string> = {};
  const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;
  const rest = header.slice(start + 'Digest'.length);
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest))) {
    const key = match[1].toLowerCase();
    if (key in params) break; // a second challenge started
    params[key] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
  }
  if (!params.nonce) return null;
  return {
    realm: params.realm ?? '',
    nonce: params.nonce,
    qop: (params.qop ?? '').split(',').map((q) => q.trim()).filter(Boolean),
    opaque: params.opaque,
    algorithm: params.algorithm ?? 'MD5',
    userhash: params.userhash === 'true',
  };
}

async function digestHash(algorithm: string, text: string): Promise<string> {
  return algorithm.toUpperCase().startsWith('SHA-256') ? sha256Hex(text) : md5Hex(text);
}

/** Builds the `Authorization: Digest …` value answering `challenge` (qop=auth, or the legacy no-qop form). */
export async function digestAuthorization(opts: {
  challenge: DigestChallenge;
  method: string;
  url: string;
  username: string;
  password: string;
  /** For tests; random otherwise. */
  cnonce?: string;
  nc?: number;
}): Promise<string> {
  const { challenge } = opts;
  const algorithm = challenge.algorithm.toUpperCase();
  if (!/^(MD5|SHA-256)(-SESS)?$/.test(algorithm)) throw new Error(`Unsupported Digest algorithm ${challenge.algorithm}`);
  const url = new URL(opts.url);
  const uri = `${url.pathname}${url.search}`;
  const cnonce = opts.cnonce ?? toHex(crypto.getRandomValues(new Uint8Array(8)));
  const nc = (opts.nc ?? 1).toString(16).padStart(8, '0');
  const useQop = challenge.qop.includes('auth');

  let ha1 = await digestHash(algorithm, `${opts.username}:${challenge.realm}:${opts.password}`);
  if (algorithm.endsWith('-SESS')) ha1 = await digestHash(algorithm, `${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = await digestHash(algorithm, `${opts.method.toUpperCase()}:${uri}`);
  const response = useQop
    ? await digestHash(algorithm, `${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : await digestHash(algorithm, `${ha1}:${challenge.nonce}:${ha2}`);

  const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;
  const parts = [
    `username=${quote(opts.username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${challenge.algorithm}`,
    `response=${quote(response)}`,
  ];
  if (useQop) parts.push('qop=auth', `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  if (challenge.opaque !== undefined) parts.push(`opaque=${quote(challenge.opaque)}`);
  return `Digest ${parts.join(', ')}`;
}
