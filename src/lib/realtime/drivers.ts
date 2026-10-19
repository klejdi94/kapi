import type { WebSocketRequestDef } from '@/types';
import { wsGraphqlDefaults, wsSocketIoDefaults } from '../factory';
import * as gql from './graphqlWs';
import * as sio from './socketio';

/**
 * What a WebSocket tab speaks, on top of raw frames. A driver turns the
 * request into a URL + subprotocols, reacts to incoming frames (answering
 * pings, subscribing after the handshake…) and describes each frame in a way
 * a person can read in the message log.
 */

export interface LogLine {
  direction: 'received' | 'sent' | 'system';
  text: string;
}

export interface WsDriver {
  /** Rewrites the request URL (Socket.IO) and picks Sec-WebSocket-Protocol values. */
  url(resolvedUrl: string): string;
  protocols: string[];
  /** Right after the socket opens. */
  start(send: (text: string) => void): LogLine[];
  /** One incoming text frame. */
  receive(text: string, send: (text: string) => void): LogLine[];
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function rawDriver(request: WebSocketRequestDef): WsDriver {
  return {
    url: (u) => u,
    protocols: request.protocols ?? [],
    start: () => [],
    receive: (text) => [{ direction: 'received', text }],
  };
}

/**
 * GraphQL subscription: connection_init → (ack) → subscribe with the query
 * and variables, then each result as it arrives. `resolve` substitutes
 * {{variables}} in the query, variables and connection params.
 */
export function graphqlDriver(request: WebSocketRequestDef, resolve: (t: string) => string): WsDriver & { stop(send: (t: string) => void): LogLine[] } {
  const cfg = request.graphql ?? wsGraphqlDefaults();
  const subprotocol = cfg.subprotocol;
  const connectionParams = gql.parseJsonField(resolve(cfg.connectionParams), 'Connection params');
  const variables = gql.parseJsonField(resolve(cfg.variables), 'Variables');
  const query = resolve(cfg.query);
  let nextId = 1;
  const active = new Set<string>();
  return {
    url: (u) => u,
    protocols: [subprotocol],
    start: (send) => {
      send(gql.connectionInit(connectionParams));
      return [{ direction: 'system', text: `connection_init (${subprotocol})` }];
    },
    receive: (text, send) => {
      const step = gql.receive(subprotocol, text);
      step.replies.forEach(send);
      const lines: LogLine[] = [];
      for (const e of step.events) {
        if (e.kind === 'ack') {
          lines.push({ direction: 'system', text: 'Connection acknowledged' });
          const id = String(nextId++);
          active.add(id);
          send(gql.subscribeFrame(subprotocol, id, { query, variables }));
          const showVars = variables !== undefined && !(typeof variables === 'object' && variables !== null && Object.keys(variables).length === 0);
          lines.push({ direction: 'sent', text: `subscribe #${id}\n${query}${showVars ? `\n${pretty(variables)}` : ''}` });
        } else if (e.kind === 'next') {
          lines.push({ direction: 'received', text: `#${e.id} ${pretty(e.payload)}` });
        } else if (e.kind === 'error') {
          lines.push({ direction: 'received', text: `error${e.id ? ` #${e.id}` : ''} ${pretty(e.payload)}` });
        } else if (e.kind === 'complete') {
          active.delete(e.id);
          lines.push({ direction: 'system', text: `Subscription #${e.id} completed` });
        } else if (e.kind === 'unknown') {
          lines.push({ direction: 'received', text: e.text });
        }
        // keep-alives aren't worth a log line
      }
      return lines;
    },
    stop: (send) => {
      const lines: LogLine[] = [];
      for (const id of active) {
        send(gql.stopFrame(subprotocol, id));
        lines.push({ direction: 'sent', text: `complete #${id}` });
      }
      active.clear();
      return lines;
    },
  };
}

/** Socket.IO: handshake, namespace connect with optional auth, events in and out, acks matched to their emits. */
export function socketIoDriver(request: WebSocketRequestDef, resolve: (t: string) => string): WsDriver & {
  emit(event: string, args: unknown[], withAck: boolean, send: (t: string) => void): LogLine[];
  connected(): boolean;
} {
  const cfg = request.socketio ?? wsSocketIoDefaults();
  const namespace = cfg.namespace.trim() || '/';
  const auth = gql.parseJsonField(resolve(cfg.auth), 'Auth');
  let nextAck = 1;
  const pending = new Map<number, string>();
  let isConnected = false;
  return {
    url: (u) => sio.socketIoUrl(u, cfg.path),
    protocols: [],
    start: () => [],
    receive: (text, send) => {
      const step = sio.receive(text, namespace, auth);
      step.replies.forEach(send);
      const lines: LogLine[] = [];
      for (const e of step.events) {
        switch (e.kind) {
          case 'open':
            lines.push({ direction: 'system', text: `Engine.IO open (sid ${e.sid}) — connecting to ${namespace}` });
            break;
          case 'connected':
            isConnected = true;
            lines.push({ direction: 'system', text: `Connected to ${e.namespace}${e.sid ? ` as ${e.sid}` : ''}` });
            break;
          case 'event':
            lines.push({ direction: 'received', text: `${e.name}${e.args.length ? ` ${pretty(e.args.length === 1 ? e.args[0] : e.args)}` : ''}${e.ackId !== undefined ? `\n(asks for ack #${e.ackId})` : ''}` });
            break;
          case 'ack': {
            const event = pending.get(e.ackId);
            pending.delete(e.ackId);
            lines.push({ direction: 'received', text: `ack for ${event ?? `#${e.ackId}`} ${pretty(e.args.length === 1 ? e.args[0] : e.args)}` });
            break;
          }
          case 'connect-error':
            lines.push({ direction: 'system', text: `Refused by ${e.namespace}: ${e.message}` });
            break;
          case 'disconnected':
            isConnected = false;
            lines.push({ direction: 'system', text: `Disconnected from ${e.namespace}` });
            break;
          case 'close':
            lines.push({ direction: 'system', text: 'Engine.IO close' });
            break;
          case 'unsupported':
            lines.push({ direction: 'received', text: `(unsupported packet) ${e.text}` });
            break;
          // pings are answered silently
        }
      }
      return lines;
    },
    emit: (event, args, withAck, send) => {
      const id = withAck ? nextAck++ : undefined;
      if (id !== undefined) pending.set(id, event);
      send(sio.emitFrame(namespace, event, args, id));
      return [{ direction: 'sent', text: `${event}${args.length ? ` ${pretty(args.length === 1 ? args[0] : args)}` : ''}${id !== undefined ? `\n(ack #${id})` : ''}` }];
    },
    connected: () => isConnected,
  };
}
