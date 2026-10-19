/**
 * GraphQL subscriptions over WebSocket, as a pure state machine: feed it the
 * text frames that arrive, send the frames it returns. Speaks both protocols
 * servers use in practice:
 *
 * - `graphql-transport-ws` (the `graphql-ws` library — Apollo Server 4,
 *   GraphQL Yoga, Hasura…): connection_init/ack, subscribe/next/error/complete,
 *   ping/pong.
 * - `graphql-ws` (the legacy `subscriptions-transport-ws`): connection_init/ack,
 *   start/data/error/complete/stop, `ka` keep-alives.
 */

export type GraphqlWsSubprotocol = 'graphql-transport-ws' | 'graphql-ws';

export type GraphqlWsEvent =
  | { kind: 'ack'; payload?: unknown }
  | { kind: 'next'; id: string; payload: unknown }
  | { kind: 'error'; id?: string; payload: unknown }
  | { kind: 'complete'; id: string }
  | { kind: 'keepalive' }
  | { kind: 'unknown'; text: string };

export interface GraphqlWsStep {
  events: GraphqlWsEvent[];
  /** Frames to send back (pong, …). */
  replies: string[];
}

export function connectionInit(connectionParams: unknown): string {
  return JSON.stringify(connectionParams === undefined ? { type: 'connection_init' } : { type: 'connection_init', payload: connectionParams });
}

export function subscribeFrame(subprotocol: GraphqlWsSubprotocol, id: string, payload: { query: string; variables?: unknown; operationName?: string }): string {
  return JSON.stringify({ id, type: subprotocol === 'graphql-transport-ws' ? 'subscribe' : 'start', payload });
}

export function stopFrame(subprotocol: GraphqlWsSubprotocol, id: string): string {
  return JSON.stringify({ id, type: subprotocol === 'graphql-transport-ws' ? 'complete' : 'stop' });
}

/** Both subprotocols' server messages are told apart by their `type`, so one parser serves both; the subprotocol is kept in the signature for clarity at call sites. */
export function receive(_subprotocol: GraphqlWsSubprotocol, text: string): GraphqlWsStep {
  let message: { type?: string; id?: string; payload?: unknown };
  try {
    message = JSON.parse(text);
  } catch {
    return { events: [{ kind: 'unknown', text }], replies: [] };
  }
  switch (message.type) {
    case 'connection_ack':
      return { events: [{ kind: 'ack', payload: message.payload }], replies: [] };
    case 'ping':
      return { events: [{ kind: 'keepalive' }], replies: [JSON.stringify({ type: 'pong' })] };
    case 'pong':
    case 'ka':
      return { events: [{ kind: 'keepalive' }], replies: [] };
    case 'next':
    case 'data':
      return { events: [{ kind: 'next', id: message.id ?? '', payload: message.payload }], replies: [] };
    case 'error':
    case 'connection_error':
      return { events: [{ kind: 'error', id: message.id, payload: message.payload }], replies: [] };
    case 'complete':
      return { events: [{ kind: 'complete', id: message.id ?? '' }], replies: [] };
    default:
      return { events: [{ kind: 'unknown', text }], replies: [] };
  }
}

/** Parses the variables / connection-params editors; empty means none. */
export function parseJsonField(text: string, what: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${what} aren't valid JSON: ${(err as Error).message}`);
  }
}
