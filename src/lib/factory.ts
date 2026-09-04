import { nanoid } from 'nanoid';
import type {
  AuthConfig,
  BodyConfig,
  Collection,
  Environment,
  FolderNode,
  KV,
  MockRoute,
  RequestDef,
  RequestNode,
  RequestSettings,
  Tab,
  WebSocketNode,
  WebSocketRequestDef,
  Workspace,
} from '@/types';

export const uid = (): string => nanoid(10);

export function kv(partial: Partial<KV> = {}): KV {
  return { id: uid(), key: '', value: '', description: '', enabled: true, kind: 'text', ...partial };
}

/** Grids always keep one blank row at the bottom for typing into. */
export function withTrailingBlank(rows: KV[]): KV[] {
  const last = rows[rows.length - 1];
  if (!last || last.key || last.value || last.fileName) return [...rows, kv({ enabled: false })];
  return rows;
}

export function emptyAuth(type: AuthConfig['type'] = 'none'): AuthConfig {
  return {
    type,
    bearer: { token: '' },
    basic: { username: '', password: '' },
    apikey: { key: '', value: '', in: 'header' },
    jwt: {
      algorithm: 'HS256',
      secret: '',
      secretIsBase64: false,
      payload: '{\n  "sub": "1234567890",\n  "name": "kapi"\n}',
      headerPrefix: 'Bearer',
      addTo: 'header',
      queryKey: 'token',
    },
    oauth2: {
      accessToken: '',
      headerPrefix: 'Bearer',
      grantType: 'client_credentials',
      authUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      audience: '',
      username: '',
      password: '',
      redirectUri: typeof location !== 'undefined' ? `${location.origin}/oauth/callback` : '',
      clientAuth: 'body',
    },
    custom: { header: '', value: '' },
  };
}

export function emptyBody(): BodyConfig {
  return {
    mode: 'none',
    text: { json: '', xml: '', html: '', text: '', javascript: '' },
    graphql: { query: '', variables: '{}' },
    formData: [kv({ enabled: false })],
    urlencoded: [kv({ enabled: false })],
    binary: null,
  };
}

export function defaultSettings(): RequestSettings {
  return {
    followRedirects: true,
    timeoutMs: 30_000,
    autoHeaders: true,
  };
}

export function newRequest(partial: Partial<RequestDef> = {}): RequestDef {
  return {
    method: 'GET',
    url: '',
    params: [kv({ enabled: false })],
    pathVars: [],
    headers: [kv({ enabled: false })],
    auth: emptyAuth('inherit'),
    body: emptyBody(),
    settings: defaultSettings(),
    examples: [],
    preRequestScript: '',
    testScript: '',
    ...partial,
  };
}

export function newRequestNode(name = 'New request', request?: Partial<RequestDef>): RequestNode {
  return { id: uid(), type: 'request', name, request: newRequest(request) };
}

export function newFolder(name = 'New folder'): FolderNode {
  return { id: uid(), type: 'folder', name, expanded: true, auth: emptyAuth('inherit'), headers: [], items: [] };
}

export function newCollection(name = 'New collection'): Collection {
  return {
    id: uid(),
    name,
    description: '',
    expanded: true,
    auth: emptyAuth('none'),
    headers: [],
    variables: [kv({ enabled: false })],
    items: [],
    preRequestScript: '',
    testScript: '',
  };
}

export function newEnvironment(name = 'New environment'): Environment {
  return { id: uid(), name, variables: [kv({ enabled: false })] };
}

export function newWorkspace(name = 'New workspace'): Workspace {
  return {
    id: uid(),
    name,
    icon: '',
    collections: [],
    environments: [],
    globals: [kv({ enabled: false })],
    activeEnvironmentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    gitRepoPath: null,
    mockServer: { port: 0, routes: [] },
  };
}

export function newMockRoute(partial: Partial<MockRoute> = {}): MockRoute {
  return {
    id: uid(),
    enabled: true,
    method: 'GET',
    path: '/',
    status: 200,
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    body: '{\n  "message": "ok"\n}',
    delayMs: 0,
    ...partial,
  };
}

export function newTab(partial: Partial<Tab> = {}): Tab {
  return {
    id: uid(),
    nodeId: null,
    collectionId: null,
    name: 'Untitled request',
    kind: 'http',
    request: newRequest({ auth: emptyAuth('none') }),
    ws: null,
    dirty: false,
    ...partial,
  };
}

export function newWebSocketRequest(partial: Partial<WebSocketRequestDef> = {}): WebSocketRequestDef {
  return { url: '', headers: [kv({ enabled: false })], protocols: [], defaultMessage: '', ...partial };
}

export function newWebSocketNode(name = 'New WebSocket', request?: Partial<WebSocketRequestDef>): WebSocketNode {
  return { id: uid(), type: 'websocket', name, request: newWebSocketRequest(request) };
}

export function newWebSocketTab(partial: Partial<Tab> = {}): Tab {
  return newTab({ kind: 'ws', name: 'New WebSocket', ws: newWebSocketRequest(), ...partial });
}

/**
 * The workspace a first-time visitor lands in. It exists so the app does
 * something impressive within a couple of seconds instead of showing a blank
 * grid — every request below runs against a public echo service.
 */
export function seedWorkspace(): Workspace {
  const ws = newWorkspace('Playground');
  const collection = newCollection('Getting started');
  collection.description = 'Live requests you can send right now. Everything is stored only on this machine.';

  const simpleGet = newRequestNode('Simple GET', {
    method: 'GET',
    url: 'https://httpbin.org/get',
    params: [kv({ key: 'hello', value: 'kapi' }), kv({ enabled: false })],
    auth: emptyAuth('none'),
  });

  const jsonPost = newRequestNode('POST JSON', {
    method: 'POST',
    url: 'https://httpbin.org/post',
    auth: emptyAuth('none'),
    body: {
      ...emptyBody(),
      mode: 'json',
      text: {
        ...emptyBody().text,
        json: '{\n  "project": "kapi",\n  "stored_on_a_server": false,\n  "tags": ["fast", "local", "private"]\n}',
      },
    },
  });

  const anyApi = newRequestNode('Any API works — no CORS setup needed', {
    method: 'GET',
    url: 'https://example.com/',
    auth: emptyAuth('none'),
  });

  const authed = newRequestNode('Bearer auth', {
    method: 'GET',
    url: 'https://httpbin.org/bearer',
    auth: { ...emptyAuth('bearer'), type: 'bearer', bearer: { token: '{{token}}' } },
  });

  const image = newRequestNode('Binary response', {
    method: 'GET',
    url: 'https://httpbin.org/image/png',
    auth: emptyAuth('none'),
  });

  const statuses = newFolder('Status codes');
  statuses.items = [
    newRequestNode('201 Created', { method: 'GET', url: 'https://httpbin.org/status/201', auth: emptyAuth('none') }),
    newRequestNode('404 Not Found', { method: 'GET', url: 'https://httpbin.org/status/404', auth: emptyAuth('none') }),
    newRequestNode('500 Server Error', { method: 'GET', url: 'https://httpbin.org/status/500', auth: emptyAuth('none') }),
  ];

  collection.items = [simpleGet, jsonPost, anyApi, authed, image, statuses];
  collection.variables = [kv({ key: 'base', value: 'https://httpbin.org' }), kv({ enabled: false })];

  const env = newEnvironment('Local');
  env.variables = [
    kv({ key: 'token', value: 'a-token-httpbin-will-echo-back' }),
    kv({ key: 'base', value: 'https://httpbin.org' }),
    kv({ enabled: false }),
  ];

  ws.collections = [collection];
  ws.environments = [env];
  ws.activeEnvironmentId = env.id;
  return ws;
}
