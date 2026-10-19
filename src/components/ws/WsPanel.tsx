import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plug, Send, Trash2, Unplug } from 'lucide-react';
import type { Collection, WebSocketRequestDef } from '@/types';
import { Button, Segmented, Badge, EmptyState, Field, Select, Checkbox } from '@/components/ui/primitives';
import { KVEditor } from '@/components/ui/KVEditor';
import { CodeEditor } from '@/components/ui/Editor';
import { connect, wsAvailable, type WsLogEntry } from '@/lib/ws';
import { useWsConnState, useWsConnections } from '@/store/wsConnections';
import { buildScope, resolve as resolveVar } from '@/lib/variables';
import { useActiveWorkspace } from '@/store/workspaces';
import { useConsole } from '@/store/console';
import { toast } from '@/lib/toast';
import { withResolvedSecretRefs } from '@/lib/secretRefs';
import { wsGraphqlDefaults, wsSocketIoDefaults } from '@/lib/factory';
import { graphqlDriver, rawDriver, socketIoDriver, type LogLine, type WsDriver } from '@/lib/realtime/drivers';
import { parseArgs } from '@/lib/realtime/socketio';

const STATUS_TONE = { idle: 'dim', connecting: 'warn', open: 'ok', closed: 'dim', error: 'danger' } as const;
const STATUS_LABEL = { idle: 'Not connected', connecting: 'Connecting…', open: 'Connected', closed: 'Closed', error: 'Error' } as const;
const INPUT = 'h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none';

type Protocol = NonNullable<WebSocketRequestDef['protocol']>;
type AnyDriver = WsDriver & Partial<ReturnType<typeof graphqlDriver>> & Partial<ReturnType<typeof socketIoDriver>>;

/** The live protocol driver per tab — module-level, because one panel instance serves whichever tab is active. */
const drivers = new Map<string, { driver: AnyDriver; send: (text: string) => void }>();

let lineCounter = 0;
const toEntry = (line: LogLine): WsLogEntry => ({ id: `line-${Date.now()}-${lineCounter++}`, direction: line.direction, kind: 'text', text: line.text, at: Date.now() });

export function WsPanel({
  tabId,
  request,
  onChange,
  collection,
}: {
  tabId: string;
  request: WebSocketRequestDef;
  onChange: (request: WebSocketRequestDef) => void;
  collection: Collection | null;
}) {
  const protocol: Protocol = request.protocol ?? 'raw';
  const [tab, setTab] = useState<'headers' | 'log' | 'query' | 'variables' | 'connection'>('log');
  const [draft, setDraft] = useState('');
  const workspace = useActiveWorkspace();
  const state = useWsConnState(tabId);
  const setConnecting = useWsConnections((s) => s.setConnecting);
  const setOpen = useWsConnections((s) => s.setOpen);
  const setClosed = useWsConnections((s) => s.setClosed);
  const setError = useWsConnections((s) => s.setError);
  const appendLog = useWsConnections((s) => s.appendLog);
  const clearLog = useWsConnections((s) => s.clearLog);

  const logRef = useRef<HTMLDivElement>(null);
  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);
  const resolve = (text: string) => resolveVar(text, scope);
  const graphql = request.graphql ?? wsGraphqlDefaults();
  const socketio = request.socketio ?? wsSocketIoDefaults();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.log.length]);

  // Disconnect whenever the tab itself goes away, not just on unmount of this
  // component (switching tabs keeps the panel mounted elsewhere in the tree).
  useEffect(() => {
    return () => {
      useWsConnections.getState().byTab[tabId]?.connection?.disconnect().catch(() => {});
      drivers.delete(tabId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const set = <K extends keyof WebSocketRequestDef>(key: K, value: WebSocketRequestDef[K]) => onChange({ ...request, [key]: value });
  const setGraphql = (patch: Partial<typeof graphql>) => onChange({ ...request, graphql: { ...graphql, ...patch } });
  const setSocketio = (patch: Partial<typeof socketio>) => onChange({ ...request, socketio: { ...socketio, ...patch } });

  const log = (lines: LogLine[]) => lines.forEach((line) => appendLog(tabId, toEntry(line)));

  const doConnect = async () => {
    setConnecting(tabId);
    try {
      const texts = [
        request.url,
        ...request.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value]),
        ...request.protocols,
        ...(protocol === 'graphql' ? [graphql.query, graphql.variables, graphql.connectionParams] : []),
        ...(protocol === 'socketio' ? [socketio.auth] : []),
      ];
      const connectScope = await withResolvedSecretRefs(texts, scope, `WebSocket ${request.url}`);
      const r = (t: string) => resolveVar(t, connectScope);
      const driver: AnyDriver = protocol === 'graphql' ? graphqlDriver(request, r) : protocol === 'socketio' ? socketIoDriver(request, r) : rawDriver(request);
      const url = driver.url(r(request.url));

      // Frames can arrive before connect() resolves (Socket.IO's server speaks
      // first), so replies queue until the connection object exists.
      const queue: string[] = [];
      const holder = { send: (text: string) => void queue.push(text) };
      drivers.set(tabId, { driver, send: (t) => holder.send(t) });

      const connection = await connect(
        request,
        connectScope,
        {
          onMessage: (entry: WsLogEntry) => {
            if (entry.kind === 'text') log(driver.receive(entry.text, (t) => holder.send(t)));
            else appendLog(tabId, entry);
            useConsole.getState().log({ kind: 'ws-receive', summary: `← ${url}: ${entry.text.slice(0, 120)}`, detail: entry.text, tabName: request.url });
          },
          onClose: (reason) => {
            drivers.delete(tabId);
            setClosed(tabId, reason);
            useConsole.getState().log({ kind: 'ws-close', summary: `${url} closed — ${reason}`, detail: reason, tabName: request.url });
          },
          onError: (message) => setError(tabId, message),
        },
        { url: driver.url, protocols: driver.protocols },
      );
      holder.send = (text) => void connection.send(text).catch((err) => toast.error('Send failed', (err as Error).message));
      queue.splice(0).forEach(holder.send);
      setOpen(tabId, connection);
      appendLog(tabId, { id: `sys-${Date.now()}`, direction: 'system', kind: 'text', text: `Connected${driver.protocols.length ? ` (${driver.protocols.join(', ')})` : ''}`, at: Date.now() });
      log(driver.start(holder.send));
      useConsole.getState().log({ kind: 'ws-connect', summary: `Connected ${url}`, detail: url, tabName: request.url });
    } catch (err) {
      drivers.delete(tabId);
      setError(tabId, (err as Error).message);
      toast.error('Could not connect', (err as Error).message);
    }
  };

  const doDisconnect = async () => {
    const current = drivers.get(tabId);
    if (current?.driver.stop) log(current.driver.stop(current.send));
    drivers.delete(tabId);
    await state.connection?.disconnect();
    setClosed(tabId);
  };

  const doSend = async () => {
    const text = resolve(draft.trim() ? draft : request.defaultMessage);
    if (!text || !state.connection) return;
    try {
      await state.connection.send(text);
      appendLog(tabId, { id: `sent-${Date.now()}`, direction: 'sent', kind: 'text', text, at: Date.now() });
      useConsole.getState().log({ kind: 'ws-send', summary: `→ ${resolve(request.url)}: ${text.slice(0, 120)}`, detail: text, tabName: request.url });
      setDraft('');
    } catch (err) {
      toast.error('Send failed', (err as Error).message);
    }
  };

  const doEmit = () => {
    const current = drivers.get(tabId);
    if (!current?.driver.emit) return;
    try {
      const args = parseArgs(resolve(socketio.args));
      log(current.driver.emit(resolve(socketio.event), args, socketio.withAck, current.send));
    } catch (err) {
      toast.error('Could not emit', (err as Error).message);
    }
  };

  if (!wsAvailable()) {
    return (
      <EmptyState
        icon={<Plug size={22} />}
        title="WebSocket needs the desktop app"
        detail="Custom handshake headers and a real socket connection aren't available from a plain browser tab."
      />
    );
  }

  const connected = state.status === 'open' || state.status === 'connecting';
  const tabs =
    protocol === 'graphql'
      ? [
          { value: 'log' as const, label: 'Messages', count: state.log.length },
          { value: 'query' as const, label: 'Subscription' },
          { value: 'variables' as const, label: 'Variables' },
          { value: 'connection' as const, label: 'Connection' },
          { value: 'headers' as const, label: 'Headers' },
        ]
      : protocol === 'socketio'
        ? [
            { value: 'log' as const, label: 'Messages', count: state.log.length },
            { value: 'connection' as const, label: 'Connection' },
            { value: 'headers' as const, label: 'Headers' },
          ]
        : [
            { value: 'log' as const, label: 'Messages', count: state.log.length },
            { value: 'headers' as const, label: 'Headers' },
          ];
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'log';
  const placeholder = protocol === 'socketio' ? 'http://localhost:3000' : protocol === 'graphql' ? 'wss://api.example.com/graphql' : 'wss://example.com/socket';
  const connectLabel = protocol === 'graphql' ? 'Subscribe' : 'Connect';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Select
          aria-label="Protocol"
          className="w-36 shrink-0"
          value={protocol}
          disabled={connected}
          onChange={(e) => {
            const next = e.target.value as Protocol;
            onChange({
              ...request,
              protocol: next,
              graphql: next === 'graphql' ? request.graphql ?? wsGraphqlDefaults() : request.graphql,
              socketio: next === 'socketio' ? request.socketio ?? wsSocketIoDefaults() : request.socketio,
            });
          }}
        >
          <option value="raw">WebSocket</option>
          <option value="graphql">GraphQL subscription</option>
          <option value="socketio">Socket.IO</option>
        </Select>
        <input
          value={request.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === 'Enter' && (state.status === 'open' ? doDisconnect() : doConnect())}
          className="h-9 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-[12.5px] focus:border-accent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        />
        {connected ? (
          <Button variant="danger" onClick={doDisconnect} disabled={state.status === 'connecting'}>
            <Unplug size={13} /> {protocol === 'graphql' ? 'Stop' : 'Disconnect'}
          </Button>
        ) : (
          <Button variant="primary" onClick={doConnect} disabled={!request.url.trim()}>
            <Plug size={13} /> {connectLabel}
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-line px-3">
        <Segmented value={activeTab} onChange={setTab} options={tabs} />
        <Badge tone={STATUS_TONE[state.status]}>{STATUS_LABEL[state.status]}</Badge>
      </div>

      {activeTab === 'headers' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="overflow-hidden rounded-md border border-line">
            <KVEditor rows={request.headers} onChange={(headers) => set('headers', headers)} showDescription resolve={resolve} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">Sent once, at connection time — WebSocket has no concept of per-message headers.</p>
          {protocol === 'raw' && (
            <Field label="Subprotocols" hint="Offered as Sec-WebSocket-Protocol at the handshake, comma-separated." className="mt-3">
              <input
                value={request.protocols.join(', ')}
                onChange={(e) => set('protocols', e.target.value.split(',').map((p) => p.trim()).filter(Boolean))}
                placeholder="e.g. mqtt, v12.stomp"
                className={INPUT}
              />
            </Field>
          )}
        </div>
      )}

      {activeTab === 'query' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-line/60 px-3 py-1.5 text-[11px] text-faint">The subscription operation. {'{{variables}}'} are substituted.</p>
          <div className="min-h-0 flex-1">
            <CodeEditor value={graphql.query} onChange={(query) => setGraphql({ query })} language="text" />
          </div>
        </div>
      )}

      {activeTab === 'variables' && (
        <div className="min-h-0 flex-1">
          <CodeEditor value={graphql.variables} onChange={(variables) => setGraphql({ variables })} language="json" />
        </div>
      )}

      {activeTab === 'connection' && protocol === 'graphql' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <Field label="Protocol" hint="graphql-transport-ws for graphql-ws servers (Apollo Server 4, Yoga, Hasura); graphql-ws for the older subscriptions-transport-ws.">
            <Select value={graphql.subprotocol} onChange={(e) => setGraphql({ subprotocol: e.target.value as typeof graphql.subprotocol })}>
              <option value="graphql-transport-ws">graphql-transport-ws</option>
              <option value="graphql-ws">graphql-ws (legacy)</option>
            </Select>
          </Field>
          <Field label="Connection params (JSON)" hint="Sent with connection_init — where servers usually expect auth, e.g. { &quot;authorization&quot;: &quot;Bearer {{token}}&quot; }.">
            <div className="h-40 overflow-hidden rounded-md border border-line">
              <CodeEditor value={graphql.connectionParams} onChange={(connectionParams) => setGraphql({ connectionParams })} language="json" />
            </div>
          </Field>
        </div>
      )}

      {activeTab === 'connection' && protocol === 'socketio' && (
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3 sm:grid-cols-2">
          <Field label="Path" hint="Where the server mounts Socket.IO.">
            <input value={socketio.path} onChange={(e) => setSocketio({ path: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Namespace">
            <input value={socketio.namespace} onChange={(e) => setSocketio({ namespace: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Auth (JSON)" hint="The handshake auth payload, e.g. { &quot;token&quot;: &quot;{{token}}&quot; }." className="sm:col-span-2">
            <input value={socketio.auth} onChange={(e) => setSocketio({ auth: e.target.value })} placeholder="{}" className={INPUT} />
          </Field>
          <p className="text-[11px] leading-relaxed text-faint sm:col-span-2">
            kapi talks Socket.IO v4 over the websocket transport directly. Binary events aren't shown.
          </p>
        </div>
      )}

      {activeTab === 'log' && (
        <>
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {state.log.length === 0 ? (
              <EmptyState
                title="No messages yet"
                detail={protocol === 'graphql' ? 'Subscribe to see each result as it arrives.' : protocol === 'socketio' ? 'Connect to see events; emit your own below.' : 'Connect, then send a message to see traffic here.'}
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {state.log.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
          {protocol === 'raw' && (
            <div className="flex items-end gap-2 border-t border-line p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={request.defaultMessage || 'Message to send…'}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doSend();
                }}
                className="h-14 flex-1 resize-none rounded-md border border-line bg-surface p-2 font-mono text-[12.5px] focus:border-accent focus:outline-none"
              />
              <Button variant="primary" onClick={doSend} disabled={state.status !== 'open'}>
                Send
              </Button>
              <Button onClick={() => clearLog(tabId)} title="Clear message log">
                <Trash2 size={13} />
              </Button>
            </div>
          )}
          {protocol === 'socketio' && (
            <div className="flex items-end gap-2 border-t border-line p-3">
              <Field label="Event" className="w-40">
                <input aria-label="Event" value={socketio.event} onChange={(e) => setSocketio({ event: e.target.value })} className={INPUT} />
              </Field>
              <Field label="Arguments (JSON)" className="flex-1">
                <input aria-label="Arguments" value={socketio.args} onChange={(e) => setSocketio({ args: e.target.value })} placeholder='["hello", { "a": 1 }]' className={INPUT} />
              </Field>
              <div className="pb-1.5">
                <Checkbox checked={socketio.withAck} onChange={(withAck) => setSocketio({ withAck })} label="Ack" />
              </div>
              <Button variant="primary" onClick={doEmit} disabled={state.status !== 'open'}>
                <Send size={13} /> Emit
              </Button>
              <Button onClick={() => clearLog(tabId)} title="Clear message log">
                <Trash2 size={13} />
              </Button>
            </div>
          )}
          {protocol === 'graphql' && state.log.length > 0 && (
            <div className="flex justify-end border-t border-line px-3 py-2">
              <Button size="sm" onClick={() => clearLog(tabId)}>
                <Trash2 size={12} /> Clear
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: WsLogEntry }) {
  if (entry.direction === 'system') {
    return <div className="px-1 text-center text-[11px] text-faint">{entry.text}</div>;
  }
  const isSent = entry.direction === 'sent';
  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${isSent ? 'border-accent/25 bg-accent/8' : 'border-line bg-surface-2'}`}>
      {isSent ? <ArrowUp size={12} className="mt-0.5 shrink-0 text-accent" /> : <ArrowDown size={12} className="mt-0.5 shrink-0 text-info" />}
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-fg">{entry.text}</pre>
      <span className="shrink-0 text-[10px] text-faint">{new Date(entry.at).toLocaleTimeString()}</span>
    </div>
  );
}
