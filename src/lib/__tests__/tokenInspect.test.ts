import { describe, it, expect } from 'vitest';
import { inspectJwt, inspectSaml, describeClaimTime } from '../tokenInspect';

function base64Url(obj: unknown): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('inspectJwt', () => {
  it('decodes header and payload, extracting exp/iat/nbf/alg', () => {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { sub: 'user-1', exp: 9999999999, iat: 1000000000 };
    const token = `${base64Url(header)}.${base64Url(payload)}.fakesignature`;
    const result = inspectJwt(token)!;
    expect(result.alg).toBe('HS256');
    expect(result.payload.sub).toBe('user-1');
    expect(result.exp).toBe(9999999999);
    expect(result.signature).toBe('fakesignature');
  });

  it('strips a leading Bearer prefix', () => {
    const token = `Bearer ${base64Url({ alg: 'none' })}.${base64Url({ sub: 'x' })}.`;
    expect(inspectJwt(token)?.payload.sub).toBe('x');
  });

  it('returns null for garbage', () => {
    expect(inspectJwt('not-a-token')).toBeNull();
  });
});

describe('describeClaimTime', () => {
  it('frames a future timestamp as "expires in"', () => {
    const seconds = Math.floor(Date.now() / 1000) + 3600;
    expect(describeClaimTime(seconds)).toContain('expires in');
  });

  it('frames a past timestamp as "was ... ago"', () => {
    const seconds = Math.floor(Date.now() / 1000) - 3600;
    expect(describeClaimTime(seconds)).toContain('ago');
  });
});

describe('inspectSaml (POST binding)', () => {
  it('decodes base64 XML directly and extracts Issuer/NameID/StatusCode/Conditions', async () => {
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
      <saml:Issuer>https://idp.example.com</saml:Issuer>
      <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
      <saml:Assertion><saml:Subject><saml:NameID>user@example.com</saml:NameID></saml:Subject>
      <saml:Conditions NotBefore="2024-01-01T00:00:00Z" NotOnOrAfter="2024-01-01T01:00:00Z"/></saml:Assertion>
    </samlp:Response>`;
    const result = await inspectSaml(btoa(xml));
    expect(result && 'kind' in result && result.kind === 'saml').toBe(true);
    if (result && 'kind' in result) {
      expect(result.binding).toBe('post');
      expect(result.issuer).toBe('https://idp.example.com');
      expect(result.nameId).toBe('user@example.com');
      expect(result.statusCode).toContain('Success');
      expect(result.notBefore).toBe('2024-01-01T00:00:00Z');
    }
  });

  it('returns null for input that is not base64 XML', async () => {
    expect(await inspectSaml('not base64 xml at all!!')).toBeNull();
  });
});
