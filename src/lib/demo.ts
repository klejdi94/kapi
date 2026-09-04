import { emptyAuth, emptyBody, kv, newCollection, newFolder, newRequestNode, newWebSocketNode, newMockRoute } from './factory';
import type { Collection, MockRoute } from '@/types';

/**
 * A live, working example of every kind of thing kapi can do — one real
 * request per feature, not a screenshot. Everything here runs against public
 * services, so clicking through actually demonstrates the feature instead of
 * just describing it.
 */
export function buildFeatureTourCollection(): Collection {
  const collection = newCollection('Feature tour');
  collection.description = 'One real, sendable example per kapi feature — methods, auth, body types, redirects, and a live WebSocket.';

  const methods = newFolder('HTTP methods');
  methods.items = [
    newRequestNode('GET', { method: 'GET', url: 'https://httpbin.org/get', auth: emptyAuth('none') }),
    newRequestNode('POST', { method: 'POST', url: 'https://httpbin.org/post', auth: emptyAuth('none') }),
    newRequestNode('PUT', { method: 'PUT', url: 'https://httpbin.org/put', auth: emptyAuth('none') }),
    newRequestNode('PATCH', { method: 'PATCH', url: 'https://httpbin.org/patch', auth: emptyAuth('none') }),
    newRequestNode('DELETE', { method: 'DELETE', url: 'https://httpbin.org/delete', auth: emptyAuth('none') }),
    newRequestNode('HEAD', { method: 'HEAD', url: 'https://httpbin.org/get', auth: emptyAuth('none') }),
  ];

  const auth = newFolder('Auth types');
  auth.items = [
    newRequestNode('Basic auth', {
      method: 'GET',
      url: 'https://httpbin.org/basic-auth/user/pass',
      auth: { ...emptyAuth('basic'), type: 'basic', basic: { username: 'user', password: 'pass' } },
    }),
    newRequestNode('Bearer token', {
      method: 'GET',
      url: 'https://httpbin.org/bearer',
      auth: { ...emptyAuth('bearer'), type: 'bearer', bearer: { token: 'demo-token' } },
    }),
    newRequestNode('API key (query)', {
      method: 'GET',
      url: 'https://httpbin.org/get',
      auth: { ...emptyAuth('apikey'), type: 'apikey', apikey: { key: 'api_key', value: 'demo-key', in: 'query' } },
    }),
    newRequestNode('API key (header)', {
      method: 'GET',
      url: 'https://httpbin.org/get',
      auth: { ...emptyAuth('apikey'), type: 'apikey', apikey: { key: 'X-API-Key', value: 'demo-key', in: 'header' } },
    }),
  ];

  const bodies = newFolder('Body types');
  bodies.items = [
    newRequestNode('JSON body', {
      method: 'POST',
      url: 'https://httpbin.org/post',
      auth: emptyAuth('none'),
      body: { ...emptyBody(), mode: 'json', text: { ...emptyBody().text, json: '{\n  "hello": "world"\n}' } },
    }),
    newRequestNode('x-www-form-urlencoded', {
      method: 'POST',
      url: 'https://httpbin.org/post',
      auth: emptyAuth('none'),
      body: { ...emptyBody(), mode: 'urlencoded', urlencoded: [kv({ key: 'name', value: 'kapi' }), kv({ enabled: false })] },
    }),
    newRequestNode('form-data', {
      method: 'POST',
      url: 'https://httpbin.org/post',
      auth: emptyAuth('none'),
      body: { ...emptyBody(), mode: 'form-data', formData: [kv({ key: 'field', value: 'value' }), kv({ enabled: false })] },
    }),
    newRequestNode('GraphQL', {
      method: 'POST',
      url: 'https://countries.trevorblades.com/',
      auth: emptyAuth('none'),
      body: { ...emptyBody(), mode: 'graphql', graphql: { query: '{\n  country(code: "US") {\n    name\n    capital\n  }\n}', variables: '{}' } },
    }),
  ];

  const behavior = newFolder('Response behavior');
  behavior.items = [
    newRequestNode('Redirect chain', { method: 'GET', url: 'https://httpbin.org/redirect/3', auth: emptyAuth('none') }),
    newRequestNode('Delay (slow response)', { method: 'GET', url: 'https://httpbin.org/delay/2', auth: emptyAuth('none') }),
    newRequestNode('Gzip-compressed', { method: 'GET', url: 'https://httpbin.org/gzip', auth: emptyAuth('none') }),
    newRequestNode('Image (binary)', { method: 'GET', url: 'https://httpbin.org/image/jpeg', auth: emptyAuth('none') }),
  ];

  const ws = newWebSocketNode('Echo server', {
    url: 'wss://ws.postman-echo.com/raw',
    defaultMessage: 'Hello from kapi!',
  });

  collection.items = [methods, auth, bodies, behavior, ws];
  return collection;
}

/** Pre-filled routes so Start actually does something the first time you try it. */
export function demoMockRoutes(): MockRoute[] {
  return [
    newMockRoute({ method: 'GET', path: '/hello', status: 200, body: '{\n  "message": "Hello from your mock server!"\n}' }),
    // The body is static — kapi's mock server matches :id in the path but
    // doesn't template it into the response body.
    newMockRoute({ method: 'GET', path: '/users/:id', status: 200, body: '{\n  "id": "demo-id",\n  "name": "Demo User"\n}' }),
    newMockRoute({ method: 'POST', path: '/echo', status: 201, body: '{\n  "received": true\n}' }),
  ];
}
