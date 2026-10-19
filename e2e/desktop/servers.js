// Local servers the desktop E2E suite talks to: an HTTP echo server and a gRPC
// Greeter with server reflection. Nothing here reaches the network.
const http = require('node:http');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const { ReflectionService } = require('@grpc/reflection');

http
  .createServer((req, res) => {
    // CORS, so the browser-based Playwright suite can call it too.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    res.setHeader('access-control-allow-methods', '*');
    if (req.method === 'OPTIONS') return res.end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  })
  .listen(18090, '127.0.0.1');

const def = loader.loadSync(__dirname + '/greeter.proto');
const pkg = grpc.loadPackageDefinition(def);
const server = new grpc.Server();
server.addService(pkg.demo.v1.Greeter.service, {
  SayHello: (call, cb) => {
    if (call.request.name === 'fail') return cb({ code: grpc.status.PERMISSION_DENIED, details: 'no fail allowed' });
    const md = new grpc.Metadata();
    md.set('x-served-by', 'node');
    call.sendMetadata(md);
    cb(null, { message: `Hello ${call.request.name}`, auth: call.metadata.get('authorization')[0] || '' });
  },
  CountTo: (call) => {
    for (let i = 1; i <= call.request.n; i++) call.write({ n: i });
    call.end();
  },
  Sum: (call, cb) => {
    let s = 0;
    call.on('data', (m) => (s += m.n));
    call.on('end', () => cb(null, { n: s }));
  },
  Chat: (call) => {
    call.on('data', (m) => call.write({ message: `echo ${m.name}` }));
    call.on('end', () => call.end());
  },
});
new ReflectionService(def).addToServer(server);
server.bindAsync('127.0.0.1:50077', grpc.ServerCredentials.createInsecure(), () => console.log('servers ready'));

// --- MQTT: an aedes broker on TCP :18883 and WebSocket :18884 (path /mqtt).
(async () => {
  const net = require('node:net');
  const { WebSocketServer, createWebSocketStream } = require('ws');
  const aedesModule = await import('aedes');
  const Aedes = aedesModule.Aedes ?? aedesModule.default;
  const broker = typeof Aedes.createBroker === 'function' ? await Aedes.createBroker() : new Aedes();
  net.createServer(broker.handle).listen(18883, '127.0.0.1');
  const wsHttp = http.createServer();
  new WebSocketServer({ server: wsHttp, path: '/mqtt' }).on('connection', (socket) => broker.handle(createWebSocketStream(socket)));
  wsHttp.listen(18884, '127.0.0.1');
})();

// --- GraphQL subscriptions (graphql-transport-ws) on :18085/graphql.
(async () => {
  const { WebSocketServer } = require('ws');
  const { buildSchema } = require('graphql');
  const { useServer } = await import('graphql-ws/use/ws');
  const schema = buildSchema('type Query { hello: String } type Subscription { countdown(from: Int!): Int }');
  const roots = {
    hello: () => 'world',
    countdown: async function* ({ from }) {
      for (let i = from; i >= 0; i--) {
        yield { countdown: i };
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
  const gqlHttp = http.createServer();
  useServer({ schema, roots: { query: roots, subscription: roots } }, new WebSocketServer({ server: gqlHttp, path: '/graphql' }));
  gqlHttp.listen(18085, '127.0.0.1');
})();

// --- Socket.IO on :18086.
(() => {
  const { Server } = require('socket.io');
  const ioHttp = http.createServer();
  const io = new Server(ioHttp);
  io.on('connection', (socket) => {
    socket.emit('welcome', { id: socket.id });
    socket.on('add', (a, b, ack) => typeof ack === 'function' && ack(a + b));
  });
  ioHttp.listen(18086, '127.0.0.1');
})();
