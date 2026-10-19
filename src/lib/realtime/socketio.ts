/**
 * Socket.IO v4 (Engine.IO v4) over a plain WebSocket, as a pure state machine.
 * kapi connects straight with the websocket transport (no HTTP long-polling
 * upgrade dance), which every Socket.IO v3/v4 server accepts unless it was
 * configured for polling only.
 *
 * Engine.IO packet types: 0 open · 1 close · 2 ping · 3 pong · 4 message.
 * Socket.IO packet types (inside an Engine.IO message): 0 CONNECT ·
 * 1 DISCONNECT · 2 EVENT · 3 ACK · 4 CONNECT_ERROR · 5/6 binary (not supported).
 */

export type SocketIoEvent =
  | { kind: 'open'; sid: string; pingInterval: number }
  | { kind: 'connected'; namespace: string; sid?: string }
  | { kind: 'event'; namespace: string; name: string; args: unknown[]; ackId?: number }
  | { kind: 'ack'; namespace: string; ackId: number; args: unknown[] }
  | { kind: 'connect-error'; namespace: string; message: string }
  | { kind: 'disconnected'; namespace: string }
  | { kind: 'ping' }
  | { kind: 'close' }
  | { kind: 'unsupported'; text: string };

export interface SocketIoStep {
  events: SocketIoEvent[];
  replies: string[];
}

/** `http(s)://host[:port]` (or ws/wss) plus the server's path → the websocket-transport URL. */
export function socketIoUrl(base: string, path = '/socket.io/'): string {
  const url = new URL(base.trim().replace(/^http/i, 'ws'));
  const p = path.trim() || '/socket.io/';
  url.pathname = (p.startsWith('/') ? p : `/${p}`).replace(/\/?$/, '/');
  url.searchParams.set('EIO', '4');
  url.searchParams.set('transport', 'websocket');
  return url.toString();
}

function nsPrefix(namespace: string): string {
  const ns = namespace.trim() || '/';
  return ns === '/' ? '' : `${ns.startsWith('/') ? ns : `/${ns}`},`;
}

export function connectFrame(namespace: string, auth?: unknown): string {
  return `40${nsPrefix(namespace)}${auth === undefined ? '' : JSON.stringify(auth)}`;
}

export function emitFrame(namespace: string, event: string, args: unknown[], ackId?: number): string {
  return `42${nsPrefix(namespace)}${ackId ?? ''}${JSON.stringify([event, ...args])}`;
}

export function ackFrame(namespace: string, ackId: number, args: unknown[]): string {
  return `43${nsPrefix(namespace)}${ackId}${JSON.stringify(args)}`;
}

/** Splits a Socket.IO packet body after its type digit: optional `/ns,`, optional ack id, optional JSON. */
function parsePacket(body: string): { namespace: string; id?: number; data?: unknown } {
  let rest = body;
  let namespace = '/';
  if (rest.startsWith('/')) {
    const comma = rest.indexOf(',');
    namespace = comma === -1 ? rest : rest.slice(0, comma);
    rest = comma === -1 ? '' : rest.slice(comma + 1);
  }
  const idMatch = /^(\d+)/.exec(rest);
  const id = idMatch ? Number(idMatch[1]) : undefined;
  if (idMatch) rest = rest.slice(idMatch[1].length);
  return { namespace, id, data: rest ? JSON.parse(rest) : undefined };
}

/**
 * Handles one incoming WebSocket text frame. `namespace` and `auth` are what
 * to connect to once the Engine.IO handshake arrives.
 */
export function receive(text: string, namespace: string, auth?: unknown): SocketIoStep {
  const type = text[0];
  const body = text.slice(1);
  try {
    switch (type) {
      case '0': {
        const open = JSON.parse(body) as { sid: string; pingInterval: number };
        return { events: [{ kind: 'open', sid: open.sid, pingInterval: open.pingInterval }], replies: [connectFrame(namespace, auth)] };
      }
      case '1':
        return { events: [{ kind: 'close' }], replies: [] };
      case '2':
        // v4: the server pings, the client answers.
        return { events: [{ kind: 'ping' }], replies: ['3'] };
      case '3':
        return { events: [], replies: [] };
      case '4':
        return { events: [socketPacket(body)], replies: [] };
      default:
        return { events: [{ kind: 'unsupported', text }], replies: [] };
    }
  } catch {
    return { events: [{ kind: 'unsupported', text }], replies: [] };
  }
}

function socketPacket(body: string): SocketIoEvent {
  const type = body[0];
  const packet = parsePacket(body.slice(1));
  switch (type) {
    case '0':
      return { kind: 'connected', namespace: packet.namespace, sid: (packet.data as { sid?: string } | undefined)?.sid };
    case '1':
      return { kind: 'disconnected', namespace: packet.namespace };
    case '2': {
      const [name, ...args] = (packet.data as unknown[]) ?? [];
      return { kind: 'event', namespace: packet.namespace, name: String(name), args, ackId: packet.id };
    }
    case '3':
      return { kind: 'ack', namespace: packet.namespace, ackId: packet.id ?? -1, args: (packet.data as unknown[]) ?? [] };
    case '4': {
      const data = packet.data as { message?: string } | string | undefined;
      return { kind: 'connect-error', namespace: packet.namespace, message: typeof data === 'string' ? data : data?.message ?? 'Connection refused' };
    }
    default:
      return { kind: 'unsupported', text: `4${body}` };
  }
}

/** The editor's "arguments" text: a JSON array of arguments, or a single JSON value as one argument. */
export function parseArgs(text: string): unknown[] {
  if (!text.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`The arguments aren't valid JSON: ${(err as Error).message}`);
  }
  return Array.isArray(value) ? value : [value];
}
