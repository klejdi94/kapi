import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plug, Trash2, Unplug } from 'lucide-react';
import type { Collection, WebSocketRequestDef } from '@/types';
import { Button, Segmented, Badge, EmptyState } from '@/components/ui/primitives';
import { KVEditor } from '@/components/ui/KVEditor';
import { connect, wsAvailable, type WsLogEntry } from '@/lib/ws';
import { useWsConnState, useWsConnections } from '@/store/wsConnections';
import { buildScope, resolve as resolveVar } from '@/lib/variables';
import { useActiveWorkspace } from '@/store/workspaces';
import { toast } from '@/lib/toast';

const STATUS_TONE = { idle: 'dim', connecting: 'warn', open: 'ok', closed: 'dim', error: 'danger' } as const;
const STATUS_LABEL = { idle: 'Not connected', connecting: 'Connecting…', open: 'Connected', closed: 'Closed', error: 'Error' } as const;

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
  const [tab, setTab] = useState<'headers' | 'log'>('log');
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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.log.length]);

  // Disconnect whenever the tab itself goes away, not just on unmount of this
  // component (switching tabs keeps the panel mounted elsewhere in the tree).
  useEffect(() => {
    return () => {
      useWsConnections.getState().byTab[tabId]?.connection?.disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const set = <K extends keyof WebSocketRequestDef>(key: K, value: WebSocketRequestDef[K]) =>
    onChange({ ...request, [key]: value });

  const doConnect = async () => {
    setConnecting(tabId);
    try {
      const connection = await connect(request, scope, {
        onMessage: (entry: WsLogEntry) => appendLog(tabId, entry),
        onClose: (reason) => setClosed(tabId, reason),
        onError: (message) => setError(tabId, message),
      });
      setOpen(tabId, connection);
      appendLog(tabId, { id: `sys-${Date.now()}`, direction: 'system', kind: 'text', text: 'Connected', at: Date.now() });
    } catch (err) {
      setError(tabId, (err as Error).message);
      toast.error('Could not connect', (err as Error).message);
    }
  };

  const doDisconnect = async () => {
    await state.connection?.disconnect();
    setClosed(tabId);
  };

  const doSend = async () => {
    const text = resolve(draft.trim() ? draft : request.defaultMessage);
    if (!text || !state.connection) return;
    try {
      await state.connection.send(text);
      appendLog(tabId, { id: `sent-${Date.now()}`, direction: 'sent', kind: 'text', text, at: Date.now() });
      setDraft('');
    } catch (err) {
      toast.error('Send failed', (err as Error).message);
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          value={request.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder="wss://example.com/socket"
          onKeyDown={(e) => e.key === 'Enter' && (state.status === 'open' ? doDisconnect() : doConnect())}
          className="h-9 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-[12.5px] focus:border-accent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
        />
        {state.status === 'open' || state.status === 'connecting' ? (
          <Button variant="danger" onClick={doDisconnect} disabled={state.status === 'connecting'}>
            <Unplug size={13} /> Disconnect
          </Button>
        ) : (
          <Button variant="primary" onClick={doConnect} disabled={!request.url.trim()}>
            <Plug size={13} /> Connect
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-line px-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'log', label: 'Messages', count: state.log.length },
            { value: 'headers', label: 'Headers' },
          ]}
        />
        <Badge tone={STATUS_TONE[state.status]}>{STATUS_LABEL[state.status]}</Badge>
      </div>

      {tab === 'headers' && (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="overflow-hidden rounded-md border border-line">
            <KVEditor rows={request.headers} onChange={(headers) => set('headers', headers)} showDescription resolve={resolve} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Sent once, at connection time — WebSocket has no concept of per-message headers.
          </p>
        </div>
      )}

      {tab === 'log' && (
        <>
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {state.log.length === 0 ? (
              <EmptyState title="No messages yet" detail="Connect, then send a message to see traffic here." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {state.log.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
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

