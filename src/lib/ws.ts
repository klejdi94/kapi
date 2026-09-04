import TauriWebSocket, { type Message } from '@tauri-apps/plugin-websocket';
import type { WebSocketRequestDef } from '@/types';
import { resolve, type VarScope } from './variables';
import { isDesktop } from './transport';

export type WsFrameKind = 'text' | 'binary' | 'ping' | 'pong' | 'close';
export type WsDirection = 'sent' | 'received' | 'system';

export interface WsLogEntry {
  id: string;
  direction: WsDirection;
  kind: WsFrameKind;
  text: string;
  at: number;
}

export interface WsConnection {
  send: (text: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface WsHandlers {
  onMessage: (entry: WsLogEntry) => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
}

let idCounter = 0;
const nextId = () => `ws-${Date.now()}-${idCounter++}`;

function messageToLog(direction: WsDirection, message: Message): WsLogEntry | null {
  if (message.type === 'Text') {
    return { id: nextId(), direction, kind: 'text', text: message.data, at: Date.now() };
  }
  if (message.type === 'Binary') {
    return { id: nextId(), direction, kind: 'binary', text: `<binary, ${message.data.length} bytes>`, at: Date.now() };
  }
  if (message.type === 'Ping' || message.type === 'Pong') {
    return { id: nextId(), direction, kind: message.type === 'Ping' ? 'ping' : 'pong', text: `${message.type} frame`, at: Date.now() };
  }
  if (message.type === 'Close') {
    return null; // surfaced via onClose instead, so it isn't logged twice
  }
  return null;
}

export function wsAvailable(): boolean {
  return isDesktop();
}

/** Resolves {{variables}} in the URL and headers, exactly like an HTTP request would. */
export function resolveWs(request: WebSocketRequestDef, scope: VarScope): { url: string; headers: [string, string][] } {
  const url = resolve(request.url, scope);
  const headers: [string, string][] = request.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => [resolve(h.key, scope), resolve(h.value, scope)]);
  return { url, headers };
}

export async function connect(
  request: WebSocketRequestDef,
  scope: VarScope,
  handlers: WsHandlers,
): Promise<WsConnection> {
  if (!wsAvailable()) {
    throw new Error('WebSocket connections need the desktop app — a plain browser tab has no way to set custom handshake headers.');
  }
  const { url, headers } = resolveWs(request, scope);
  if (!url.trim()) throw new Error('Enter a URL before connecting.');

  const headerRecord = Object.fromEntries(headers);
  const socket = await TauriWebSocket.connect(url, {
    headers: Object.keys(headerRecord).length ? headerRecord : undefined,
  });

  socket.addListener((message) => {
    if (message.type === 'Close') {
      const frame = message.data;
      handlers.onClose(frame ? `Closed (${frame.code}): ${frame.reason}` : 'Closed');
      return;
    }
    const entry = messageToLog('received', message);
    if (entry) handlers.onMessage(entry);
  });

  return {
    send: async (text: string) => {
      await socket.send(text);
    },
    disconnect: async () => {
      await socket.disconnect();
    },
  };
}
