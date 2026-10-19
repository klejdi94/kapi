import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import { createRequire } from 'node:module';
import { Server as SocketIoServer } from 'socket.io';
import * as gql from '../realtime/graphqlWs';
import * as sio from '../realtime/socketio';

/**
 * The protocol state machines against the real server libraries — graphql-ws,
 * the legacy subscriptions-transport-ws, and socket.io — over Node's own
 * WebSocket client, so a mismatch with what servers actually speak fails here.
 */

// Both servers run outside Vite's module graph and load graphql's CommonJS
// build, so the schema must come from that same copy ("another realm" otherwise).
const { buildSchema, execute, subscribe } = createRequire(import.meta.url)('graphql') as typeof import('graphql');

const schema = buildSchema(`
  type Query { hello: String }
  type Subscription { countdown(from: Int!): Int, greetings: String }
`);
const roots = {
  hello: () => 'world',
  countdown: async function* ({ from }: { from: number }) {
    for (let i = from; i >= 0; i--) yield { countdown: i };
  },
  greetings: async function* () {
    for (const g of ['hi', 'hola']) yield { greetings: g };
  },
};

let gqlUrl = '';
let legacyUrl = '';
let sioUrl = '';
const servers: { close: () => void }[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

beforeAll(async () => {
  const modern = http.createServer();
  const wss = new WebSocketServer({ server: modern, path: '/graphql' });
  useServer(
    {
      schema,
      roots: { subscription: roots, query: roots },
      onConnect: (ctx) => (ctx.connectionParams as { token?: string } | undefined)?.token === 'ok',
    },
    wss,
  );
  gqlUrl = `ws://127.0.0.1:${await listen(modern)}/graphql`;
  servers.push(modern);

  const legacy = http.createServer();
  const legacyPort = await listen(legacy);
  SubscriptionServer.create({ schema, execute, subscribe, rootValue: roots }, { server: legacy, path: '/subscriptions' });
  legacyUrl = `ws://127.0.0.1:${legacyPort}/subscriptions`;
  servers.push(legacy);

  const sioHttp = http.createServer();
  const io = new SocketIoServer(sioHttp);
  io.on('connection', (socket) => {
    socket.emit('welcome', { id: socket.id });
    socket.on('add', (a: number, b: number, ack: (sum: number) => void) => ack(a + b));
    socket.on('echo', (msg: unknown) => socket.emit('echoed', msg));
  });
  io.of('/admin').use((socket, next) => (socket.handshake.auth?.token === 'secret' ? next() : next(new Error('not authorized'))));
  io.of('/admin').on('connection', (socket) => socket.emit('hello-admin'));
  sioUrl = `http://127.0.0.1:${await listen(sioHttp)}`;
  servers.push({ close: () => io.close() });
});

afterAll(() => {
  for (const s of servers) s.close();
});

/** A WebSocket client driving a state machine until `done` says stop. */
function drive(
  url: string,
  protocols: string[] | undefined,
  onOpen: (send: (t: string) => void) => void,
  onText: (text: string, send: (t: string) => void) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocols);
    const send = (t: string) => ws.send(t);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out'));
    }, 5000);
    ws.onopen = () => onOpen(send);
    ws.onmessage = (e) => {
      if (onText(String(e.data), send)) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    };
    ws.onerror = () => reject(new Error('socket error'));
  });
}

describe('GraphQL subscriptions', () => {
  it('graphql-transport-ws: init with params, subscribe, receive every value, complete', async () => {
    const values: unknown[] = [];
    let acked = false;
    await drive(
      gqlUrl,
      ['graphql-transport-ws'],
      (send) => send(gql.connectionInit({ token: 'ok' })),
      (text, send) => {
        const step = gql.receive('graphql-transport-ws', text);
        step.replies.forEach(send);
        for (const e of step.events) {
          if (e.kind === 'ack') {
            acked = true;
            send(gql.subscribeFrame('graphql-transport-ws', '1', { query: 'subscription($n: Int!) { countdown(from: $n) }', variables: { n: 3 } }));
          }
          if (e.kind === 'next') values.push((e.payload as { data: { countdown: number } }).data.countdown);
          if (e.kind === 'complete') return true;
        }
        return false;
      },
    );
    expect(acked).toBe(true);
    expect(values).toEqual([3, 2, 1, 0]);
  });

  it('graphql-transport-ws: a refused connection_init is reported', async () => {
    const closed = await new Promise<number>((resolve) => {
      const ws = new WebSocket(gqlUrl, ['graphql-transport-ws']);
      ws.onopen = () => ws.send(gql.connectionInit({ token: 'wrong' }));
      ws.onclose = (e) => resolve(e.code);
    });
    expect(closed).toBe(4403); // graphql-ws: Forbidden
  });

  it('legacy graphql-ws (subscriptions-transport-ws): start/data/complete', async () => {
    const values: unknown[] = [];
    await drive(
      legacyUrl,
      ['graphql-ws'],
      (send) => send(gql.connectionInit(undefined)),
      (text, send) => {
        const step = gql.receive('graphql-ws', text);
        step.replies.forEach(send);
        for (const e of step.events) {
          if (e.kind === 'ack') send(gql.subscribeFrame('graphql-ws', '7', { query: 'subscription { greetings }' }));
          if (e.kind === 'next') values.push((e.payload as { data: { greetings: string } }).data.greetings);
          if (e.kind === 'complete') return true;
        }
        return false;
      },
    );
    expect(values).toEqual(['hi', 'hola']);
  });

  it('answers pings and rejects invalid JSON fields clearly', () => {
    expect(gql.receive('graphql-transport-ws', '{"type":"ping"}').replies).toEqual(['{"type":"pong"}']);
    expect(() => gql.parseJsonField('{', 'Variables')).toThrow(/Variables aren't valid JSON/);
    expect(gql.parseJsonField('  ', 'Variables')).toBeUndefined();
  });
});

describe('Socket.IO', () => {
  it('builds the websocket-transport URL', () => {
    expect(sio.socketIoUrl('https://api.example.com')).toBe('wss://api.example.com/socket.io/?EIO=4&transport=websocket');
    expect(sio.socketIoUrl('http://localhost:3000', 'realtime')).toBe('ws://localhost:3000/realtime/?EIO=4&transport=websocket');
  });

  it('connects, receives an event, emits with an ack, and round-trips an echo', async () => {
    const events: sio.SocketIoEvent[] = [];
    await drive(
      sio.socketIoUrl(sioUrl),
      undefined,
      () => {},
      (text, send) => {
        const step = sio.receive(text, '/');
        step.replies.forEach(send);
        for (const e of step.events) {
          events.push(e);
          if (e.kind === 'connected') {
            send(sio.emitFrame('/', 'add', [2, 3], 1));
            send(sio.emitFrame('/', 'echo', [{ hello: 'kapi' }]));
          }
        }
        return events.some((e) => e.kind === 'ack') && events.some((e) => e.kind === 'event' && e.name === 'echoed');
      },
    );
    expect(events[0]).toMatchObject({ kind: 'open' });
    expect(events.find((e) => e.kind === 'event' && e.name === 'welcome')).toBeTruthy();
    expect(events.find((e) => e.kind === 'ack')).toEqual({ kind: 'ack', namespace: '/', ackId: 1, args: [5] });
    expect(events.find((e) => e.kind === 'event' && e.name === 'echoed')).toMatchObject({ args: [{ hello: 'kapi' }] });
  });

  it('connects to a namespace with auth, and reports a refused one', async () => {
    const ok: sio.SocketIoEvent[] = [];
    await drive(sio.socketIoUrl(sioUrl), undefined, () => {}, (text, send) => {
      const step = sio.receive(text, '/admin', { token: 'secret' });
      step.replies.forEach(send);
      ok.push(...step.events);
      return ok.some((e) => e.kind === 'event' && e.name === 'hello-admin');
    });
    expect(ok.find((e) => e.kind === 'connected')).toMatchObject({ namespace: '/admin' });

    const refused: sio.SocketIoEvent[] = [];
    await drive(sio.socketIoUrl(sioUrl), undefined, () => {}, (text, send) => {
      const step = sio.receive(text, '/admin', { token: 'nope' });
      step.replies.forEach(send);
      refused.push(...step.events);
      return refused.some((e) => e.kind === 'connect-error');
    });
    expect(refused.find((e) => e.kind === 'connect-error')).toEqual({ kind: 'connect-error', namespace: '/admin', message: 'not authorized' });
  });

  it('parses arguments the way the editor accepts them', () => {
    expect(sio.parseArgs('[1, "a"]')).toEqual([1, 'a']);
    expect(sio.parseArgs('{"a":1}')).toEqual([{ a: 1 }]);
    expect(sio.parseArgs('')).toEqual([]);
    expect(() => sio.parseArgs('[')).toThrow(/aren't valid JSON/);
  });
});

describe('WebSocket drivers', () => {
  it('GraphQL: subscribes after ack and describes each result', async () => {
    const { graphqlDriver } = await import('../realtime/drivers');
    const { newWebSocketRequest, wsGraphqlDefaults } = await import('../factory');
    const driver = graphqlDriver(
      newWebSocketRequest({ url: gqlUrl, protocol: 'graphql', graphql: { ...wsGraphqlDefaults(), query: 'subscription { countdown(from: {{n}}) }', connectionParams: '{"token":"ok"}' } }),
      (t) => t.replace('{{n}}', '2'),
    );
    expect(driver.protocols).toEqual(['graphql-transport-ws']);
    const lines: string[] = [];
    await drive(gqlUrl, driver.protocols, (send) => driver.start(send), (text, send) => {
      const out = driver.receive(text, send);
      lines.push(...out.map((l) => `${l.direction}: ${l.text.replace(/\s+/g, ' ')}`));
      return out.some((l) => l.text.includes('completed'));
    });
    expect(lines).toEqual([
      'system: Connection acknowledged',
      'sent: subscribe #1 subscription { countdown(from: 2) }',
      'received: #1 { "data": { "countdown": 2 } }',
      'received: #1 { "data": { "countdown": 1 } }',
      'received: #1 { "data": { "countdown": 0 } }',
      'system: Subscription #1 completed',
    ]);
  });

  it('Socket.IO: connects, emits with an ack and matches the ack to its event', async () => {
    const { socketIoDriver } = await import('../realtime/drivers');
    const { newWebSocketRequest, wsSocketIoDefaults } = await import('../factory');
    const driver = socketIoDriver(newWebSocketRequest({ url: sioUrl, protocol: 'socketio', socketio: wsSocketIoDefaults() }), (t) => t);
    const lines: string[] = [];
    let emitted = false;
    await drive(driver.url(sioUrl), undefined, () => {}, (text, send) => {
      const out = driver.receive(text, send);
      lines.push(...out.map((l) => `${l.direction}: ${l.text.replace(/\s+/g, ' ')}`));
      if (driver.connected() && !emitted) {
        emitted = true;
        lines.push(...driver.emit('add', [20, 22], true, send).map((l) => `${l.direction}: ${l.text.replace(/\s+/g, ' ')}`));
      }
      return lines.some((l) => l.startsWith('received: ack for add'));
    });
    expect(lines[0]).toMatch(/^system: Engine\.IO open \(sid .+\) — connecting to \/$/);
    expect(lines).toContain('sent: add [ 20, 22 ] (ack #1)');
    expect(lines).toContain('received: ack for add 42');
    expect(lines.some((l) => l.startsWith('received: welcome {'))).toBe(true);
  });
});

describe('MQTT topic filters', () => {
  it('matches + and # the way brokers do', async () => {
    const { topicMatches } = await import('../mqtt');
    expect(topicMatches('#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+/c', 'a/b/d')).toBe(false);
    expect(topicMatches('a/#', 'a')).toBe(true);
    expect(topicMatches('a/b', 'a/b/c')).toBe(false);
    expect(topicMatches('a/+', 'a')).toBe(false);
  });
});
