import { describe, it, expect } from 'vitest';
import { templatePath, groupCaptures, buildCollectionFromEndpoints, type CapturedCall } from '../discovery';

describe('templatePath', () => {
  it('templates numeric and uuid segments', () => {
    expect(templatePath('/users/123/orders/8f14e45f-ceea-467e-adc8-38a5c98a5f0a')).toBe('/users/:id/orders/:id');
  });
  it('leaves literal segments alone', () => {
    expect(templatePath('/users/me/profile')).toBe('/users/me/profile');
  });
  it('templates a 24-hex-char Mongo-style ObjectId', () => {
    expect(templatePath('/items/507f1f77bcf86cd799439011')).toBe('/items/:id');
  });
});

describe('groupCaptures', () => {
  it('dedupes by method+templated path, merges query param names, drops html responses', () => {
    const entries: CapturedCall[] = [
      { method: 'GET', url: 'https://api.example.com/users/1?verbose=true', status: 200, requestHeaders: [['authorization', '<redacted>']], responseContentType: 'application/json', at: 1 },
      { method: 'GET', url: 'https://api.example.com/users/2?fields=name', status: 200, requestHeaders: [['authorization', '<redacted>']], responseContentType: 'application/json', at: 2 },
      { method: 'GET', url: 'https://api.example.com/', status: 200, requestHeaders: [], responseContentType: 'text/html', at: 3 },
    ];
    const grouped = groupCaptures(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].path).toBe('/users/:id');
    expect(grouped[0].hits).toBe(2);
    expect(grouped[0].queryParamNames.sort()).toEqual(['fields', 'verbose']);
  });

  it('ignores malformed URLs and non-http schemes', () => {
    const entries: CapturedCall[] = [
      { method: 'GET', url: 'not a url', status: 200, requestHeaders: [], responseContentType: '', at: 1 },
      { method: 'GET', url: 'blob:https://x/1234', status: 200, requestHeaders: [], responseContentType: '', at: 2 },
    ];
    expect(groupCaptures(entries)).toEqual([]);
  });
});

describe('buildCollectionFromEndpoints', () => {
  it('redacts secret headers into {{variables}} and builds a starter environment', () => {
    const { collection, environment } = buildCollectionFromEndpoints(
      [
        {
          id: 'GET api.example.com/users/:id', method: 'GET', host: 'api.example.com', path: '/users/:id',
          hits: 3, status: 200,
          requestHeaders: [['authorization', '<redacted>'], ['x-custom', 'plain']],
          responseContentType: 'application/json', queryParamNames: ['verbose'], lastSeenAt: 1,
        },
      ],
      'api.example.com',
    );
    const node = collection.items[0] as any;
    expect(node.request.url).toBe('https://api.example.com/users/:id');
    const authHeader = node.request.headers.find((h: any) => h.key === 'authorization');
    expect(authHeader.value).toBe('{{authorization}}');
    const customHeader = node.request.headers.find((h: any) => h.key === 'x-custom');
    expect(customHeader.value).toBe('plain');
    expect(environment?.variables.some((v: any) => v.key === 'authorization')).toBe(true);
  });

  it('groups endpoints from more than one host into per-host folders', () => {
    const { collection } = buildCollectionFromEndpoints(
      [
        { id: '1', method: 'GET', host: 'a.com', path: '/x', hits: 1, status: 200, requestHeaders: [], responseContentType: '', queryParamNames: [], lastSeenAt: 1 },
        { id: '2', method: 'GET', host: 'b.com', path: '/y', hits: 1, status: 200, requestHeaders: [], responseContentType: '', queryParamNames: [], lastSeenAt: 1 },
      ],
      'Discovered API',
    );
    expect(collection.items).toHaveLength(2);
    expect(collection.items.every((n) => n.type === 'folder')).toBe(true);
  });
});
