/** Decodes JWTs and SAML responses for inspection — nothing is sent anywhere, it's all local string/DOM work. */

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const utf8 = new TextDecoder();

export interface JwtInspection {
  kind: 'jwt';
  header: unknown;
  payload: Record<string, unknown>;
  signature: string;
  alg: string | null;
  typ: string | null;
  exp: number | null;
  iat: number | null;
  nbf: number | null;
}

/** `header.payload.signature`, base64url — the signature is shown but never verified (no key to check it against, and that's not what this is for). */
export function inspectJwt(raw: string): JwtInspection | null {
  const token = raw.trim().replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(utf8.decode(base64UrlToBytes(parts[0])));
    const payload = JSON.parse(utf8.decode(base64UrlToBytes(parts[1])));
    if (typeof header !== 'object' || typeof payload !== 'object') return null;
    return {
      kind: 'jwt',
      header,
      payload,
      signature: parts[2] ?? '',
      alg: (header as Record<string, unknown>).alg ? String((header as Record<string, unknown>).alg) : null,
      typ: (header as Record<string, unknown>).typ ? String((header as Record<string, unknown>).typ) : null,
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      iat: typeof payload.iat === 'number' ? payload.iat : null,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : null,
    };
  } catch {
    return null;
  }
}

/** `2024-01-01T00:00:00.000Z (expires in 3h)` / `… (expired 2d ago)` — human framing around a JWT numeric-date claim. */
export function describeClaimTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const deltaMs = date.getTime() - Date.now();
  const abs = Math.abs(deltaMs);
  const [unitMs, unitLabel]: [number, string] =
    abs > 86_400_000 ? [86_400_000, 'd'] : abs > 3_600_000 ? [3_600_000, 'h'] : abs > 60_000 ? [60_000, 'm'] : [1000, 's'];
  const amount = Math.round(abs / unitMs);
  const relative = deltaMs >= 0 ? `in ${amount}${unitLabel}` : `${amount}${unitLabel} ago`;
  return `${date.toLocaleString()} (${deltaMs >= 0 ? 'expires' : 'was'} ${relative})`;
}

/** Very small formatter — inserts newlines/indentation between tags. Good enough to read; not a real XML pretty-printer. */
function prettyXml(xml: string): string {
  const withBreaks = xml.replace(/>\s*</g, '>\n<').trim();
  let depth = 0;
  return withBreaks
    .split('\n')
    .map((line) => {
      const isClosing = /^<\//.test(line);
      const isSelfClosing = /\/>$/.test(line) || /^<\?/.test(line);
      if (isClosing) depth = Math.max(0, depth - 1);
      const indented = '  '.repeat(depth) + line;
      if (!isClosing && !isSelfClosing && /^<[^/!?]/.test(line)) depth += 1;
      return indented;
    })
    .join('\n');
}

function localName(doc: Document, name: string): Element | null {
  return [...doc.querySelectorAll('*')].find((el) => el.localName === name) ?? null;
}

export interface SamlInspection {
  kind: 'saml';
  binding: 'post' | 'redirect';
  xml: string;
  issuer: string | null;
  nameId: string | null;
  statusCode: string | null;
  notBefore: string | null;
  notOnOrAfter: string | null;
  audience: string | null;
}

function toSamlInspection(xmlText: string, binding: 'post' | 'redirect'): SamlInspection | null {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const conditions = localName(doc, 'Conditions');
  return {
    kind: 'saml',
    binding,
    xml: prettyXml(xmlText),
    issuer: localName(doc, 'Issuer')?.textContent?.trim() || null,
    nameId: localName(doc, 'NameID')?.textContent?.trim() || null,
    statusCode: localName(doc, 'StatusCode')?.getAttribute('Value') || null,
    notBefore: conditions?.getAttribute('NotBefore') || null,
    notOnOrAfter: conditions?.getAttribute('NotOnOrAfter') || null,
    audience: localName(doc, 'Audience')?.textContent?.trim() || null,
  };
}

/**
 * POST-binding `SAMLResponse` values are just base64 XML — decoded directly.
 * Redirect-binding ones are additionally raw-deflated first; that needs
 * `DecompressionStream`, which isn't guaranteed in every webview, so it's
 * tried and reported honestly if unavailable rather than failing silently.
 */
export async function inspectSaml(raw: string): Promise<SamlInspection | { error: string } | null> {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(cleaned);
  } catch {
    return null;
  }

  const direct = utf8.decode(bytes).trim();
  if (direct.startsWith('<')) return toSamlInspection(direct, 'post');

  if (typeof DecompressionStream === 'undefined') {
    return { error: "This doesn't decode as plain base64 XML, and inflating a redirect-binding SAMLResponse needs DecompressionStream, which isn't available here." };
  }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflatedBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    const inflated = utf8.decode(inflatedBytes).trim();
    if (!inflated.startsWith('<')) return null;
    return toSamlInspection(inflated, 'redirect');
  } catch {
    return null;
  }
}

export type TokenInspection = JwtInspection | SamlInspection;

/** Tries JWT first (cheap, synchronous, very distinctive shape), then SAML. */
export async function inspectToken(raw: string): Promise<TokenInspection | { error: string } | null> {
  const jwt = inspectJwt(raw);
  if (jwt) return jwt;
  return inspectSaml(raw);
}
