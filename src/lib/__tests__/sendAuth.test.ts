import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { send, withUrlParams } from '../send';
import { emptyAuth, newRequest } from '../factory';
import { md5Hex } from '../authSigning';

/**
 * A tiny server that speaks Digest the way RFC 7616 servers do (MD5, qop=auth)
 * and echoes what it received, so send()'s challenge/response round-trip and
 * SigV4 headers are checked over a real socket.
 */
let base = '';
let server: http.Server;
const seen: { authorization?: string; amzDate?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ authorization: req.headers.authorization, amzDate: req.headers['x-amz-date'] as string | undefined });
    if (req.url?.startsWith('/digest')) {
      const auth = req.headers.authorization ?? '';
      const field = (name: string) => new RegExp(`${name}="?([^",]+)"?`).exec(auth)?.[1] ?? '';
      if (!auth.startsWith('Digest ')) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="kapi", qop="auth", nonce="abc123", opaque="xyz", algorithm=MD5' });
        return res.end();
      }
      const ha1 = md5Hex('ada:kapi:lovelace');
      const ha2 = md5Hex(`GET:${field('uri')}`);
      const expected = md5Hex(`${ha1}:abc123:${field('nc')}:${field('cnonce')}:auth:${ha2}`);
      res.writeHead(field('response') === expected ? 200 : 403, { 'Content-Type': 'text/plain' });
      return res.end(field('response') === expected ? 'welcome' : 'bad digest');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('send() with signing auth', () => {
  it('answers a Digest challenge and retries once', async () => {
    seen.length = 0;
    // Query params live in the params grid (the URL bar keeps them in sync); the signed uri must include them.
    const request = withUrlParams(newRequest({ url: `${base}/digest/area?x=1`, auth: { ...emptyAuth('digest'), digest: { username: 'ada', password: 'lovelace' } } }));
    const result = await send(request, new Map());
    expect(result.ok && result.response.status).toBe(200);
    expect(result.ok && result.response.text).toBe('welcome');
    expect(seen).toHaveLength(2);
    expect(seen[0].authorization).toBeUndefined();
    expect(seen[1].authorization).toMatch(/^Digest username="ada", realm="kapi", nonce="abc123", uri="\/digest\/area\?x=1"/);
    expect(result.ok && result.response.sent.headers.some(([k]) => k === 'Authorization')).toBe(true);
  });

  it('signs with AWS SigV4', async () => {
    seen.length = 0;
    const request = newRequest({
      url: `${base}/aws`,
      auth: { ...emptyAuth('awsv4'), awsv4: { accessKey: 'AKID', secretKey: 'secret', sessionToken: '', region: 'eu-west-1', service: 'execute-api' } },
    });
    const result = await send(request, new Map());
    expect(result.ok).toBe(true);
    expect(seen[0].amzDate).toMatch(/^\d{8}T\d{6}Z$/);
    expect(seen[0].authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-1\/execute-api\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});
