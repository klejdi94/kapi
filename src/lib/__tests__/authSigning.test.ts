import { describe, expect, it } from 'vitest';
import { digestAuthorization, md5Hex, parseDigestChallenge, signAwsV4 } from '../authSigning';

// Vectors from AWS's published Signature Version 4 test suite.
const AWS = {
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
  date: new Date('2015-08-30T12:36:00Z'),
};

const authorization = (headers: [string, string][]) => headers.find(([k]) => k === 'Authorization')?.[1];

describe('AWS Signature V4', () => {
  it('get-vanilla', async () => {
    const headers = await signAwsV4({ ...AWS, method: 'GET', url: 'https://example.amazonaws.com/', headers: [], body: null });
    expect(headers).toContainEqual(['X-Amz-Date', '20150830T123600Z']);
    expect(authorization(headers)).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('get-vanilla-query-order-key-case', async () => {
    const headers = await signAwsV4({ ...AWS, method: 'GET', url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1', headers: [], body: null });
    expect(authorization(headers)).toMatch(/Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500$/);
  });

  it('post-x-www-form-urlencoded', async () => {
    const headers = await signAwsV4({
      ...AWS,
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      body: new TextEncoder().encode('Param1=value1'),
    });
    expect(authorization(headers)).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
    );
  });

  it('adds the session token and, for S3, the payload hash', async () => {
    const headers = await signAwsV4({ ...AWS, service: 's3', sessionToken: 'tok', method: 'PUT', url: 'https://bucket.s3.amazonaws.com/a b.txt', headers: [], body: new TextEncoder().encode('hi') });
    expect(headers).toContainEqual(['X-Amz-Security-Token', 'tok']);
    expect(headers).toContainEqual(['X-Amz-Content-Sha256', '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4']);
    expect(authorization(headers)).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
  });

  it('uses UNSIGNED-PAYLOAD when the body bytes are not known', async () => {
    const headers = await signAwsV4({ ...AWS, service: 's3', method: 'POST', url: 'https://bucket.s3.amazonaws.com/', headers: [], body: 'unsigned' });
    expect(headers).toContainEqual(['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD']);
  });
});

describe('HTTP Digest', () => {
  it('md5', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5Hex('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });

  // RFC 7616 §3.9.1
  const header =
    'Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=MD5, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"';
  const rfc = { method: 'GET', url: 'http://www.example.org/dir/index.html', username: 'Mufasa', password: 'Circle of Life', cnonce: 'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ' };

  it('parses a challenge, including one listed with other schemes', () => {
    const challenge = parseDigestChallenge(`Basic realm="x", ${header}`);
    expect(challenge).toMatchObject({ realm: 'http-auth@example.org', qop: ['auth', 'auth-int'], algorithm: 'MD5' });
    expect(parseDigestChallenge('Bearer realm="x"')).toBeNull();
  });

  it('answers the RFC 7616 MD5 example', async () => {
    const value = await digestAuthorization({ ...rfc, challenge: parseDigestChallenge(header)! });
    expect(value).toContain('response="8ca523f5e9506fed4657c9700eebdbec"');
    expect(value).toContain('qop=auth, nc=00000001');
    expect(value).toContain('opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"');
  });

  it('answers the RFC 7616 SHA-256 example', async () => {
    const value = await digestAuthorization({ ...rfc, challenge: parseDigestChallenge(header.replace('algorithm=MD5', 'algorithm=SHA-256'))! });
    expect(value).toContain('response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"');
  });
});
