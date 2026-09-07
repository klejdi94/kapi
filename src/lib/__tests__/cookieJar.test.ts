import { describe, it, expect } from 'vitest';
import { cookiesFromSetHeaders, cookieHeaderFor } from '../cookieJar';

describe('cookiesFromSetHeaders', () => {
  it('parses name/value/domain/path/maxAge into a StoredCookie', () => {
    const [cookie] = cookiesFromSetHeaders('https://api.example.com/login', ['session=abc123; Path=/; Max-Age=3600; HttpOnly; Secure']);
    expect(cookie.name).toBe('session');
    expect(cookie.value).toBe('abc123');
    expect(cookie.domain).toBe('api.example.com');
    expect(cookie.path).toBe('/');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.expires).toBeGreaterThan(Date.now());
  });

  it('defaults domain to the request host when none is given, and expires stays null for a session cookie', () => {
    const [cookie] = cookiesFromSetHeaders('https://sub.example.com/a', ['id=1']);
    expect(cookie.domain).toBe('sub.example.com');
    expect(cookie.expires).toBeNull();
  });

  it('skips a Set-Cookie header with no name', () => {
    expect(cookiesFromSetHeaders('https://example.com/', ['=value'])).toEqual([]);
  });
});

describe('cookieHeaderFor', () => {
  const cookies = [
    { name: 'a', value: '1', domain: 'example.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 },
    { name: 'b', value: '2', domain: 'other.com', path: '/', expires: null, secure: false, httpOnly: false, setAt: 0 },
    { name: 'c', value: '3', domain: 'example.com', path: '/admin', expires: null, secure: false, httpOnly: false, setAt: 0 },
    { name: 'expired', value: '4', domain: 'example.com', path: '/', expires: Date.now() - 1000, secure: false, httpOnly: false, setAt: 0 },
    { name: 'secureonly', value: '5', domain: 'example.com', path: '/', expires: null, secure: true, httpOnly: false, setAt: 0 },
  ];

  it('matches by domain (including subdomains) and path, skips expired and cross-host cookies', () => {
    const header = cookieHeaderFor(cookies, 'https://sub.example.com/dashboard');
    expect(header).toContain('a=1');
    expect(header).not.toContain('b=2');
    expect(header).not.toContain('c=3');
    expect(header).not.toContain('expired=4');
  });

  it('only sends secure cookies over https', () => {
    expect(cookieHeaderFor(cookies, 'http://example.com/')).not.toContain('secureonly=5');
    expect(cookieHeaderFor(cookies, 'https://example.com/')).toContain('secureonly=5');
  });

  it('includes path-scoped cookies only under that path', () => {
    expect(cookieHeaderFor(cookies, 'https://example.com/admin/users')).toContain('c=3');
    expect(cookieHeaderFor(cookies, 'https://example.com/other')).not.toContain('c=3');
  });

  it('returns null when nothing matches', () => {
    expect(cookieHeaderFor(cookies, 'https://totally-unrelated.com/')).toBeNull();
  });
});
