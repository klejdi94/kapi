import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plug, Plus, Send, Trash2, Unplug, X } from 'lucide-react';
import clsx from 'clsx';
import type { Collection, MqttRequestDef } from '@/types';
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Segmented, Select } from '@/components/ui/primitives';
import { useActiveWorkspace } from '@/store/workspaces';
import { useConsole } from '@/store/console';
import { useMqttSession, useMqttSessions } from '@/store/mqttSessions';
import { buildScope, resolve as resolveVar, type VarScope } from '@/lib/variables';
import { mqttAvailable, mqttConnect, mqttDisconnect, mqttPublish, mqttSubscribe, mqttTexts, mqttUnsubscribe, topicMatches } from '@/lib/mqtt';
import { withResolvedSecretRefs } from '@/lib/secretRefs';
import { toast } from '@/lib/toast';

const INPUT = 'h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none';
const STATUS_TONE = { idle: 'dim', connecting: 'warn', open: 'ok', closed: 'dim', error: 'danger' } as const;
const STATUS_LABEL = { idle: 'Not connected', connecting: 'Connecting…', open: 'Connected', closed: 'Closed', error: 'Error' } as const;

/** The scope a live session was opened with, so subscribe/publish resolve variables (and external secrets) the same way. */
const sessionScopes = new Map<string, VarScope>();

/**
 * An MQTT connection: broker settings, a list of subscriptions applied on
 * connect (and live, as they're added or removed), a publish box, and a log
 * of every message with a topic filter.
 */
export function MqttPanel({
  tabId,
  request,
  onChange,
  collection,
}: {
  tabId: string;
  request: MqttRequestDef;
  onChange: (request: MqttRequestDef) => void;
  collection: Collection | null;
}) {
  const workspace = useActiveWorkspace();
  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);
  const session = useMqttSession(tabId);
  const patch = useMqttSessions((s) => s.patch);
  const append = useMqttSessions((s) => s.append);
  const clear = useMqttSessions((s) => s.clear);
  const [section, setSection] = useState<'messages' | 'connection'>('messages');
  const [filter, setFilter] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  const set = (p: Partial<MqttRequestDef>) => onChange({ ...request, ...p });
  const r = (t: string) => resolveVar(t, sessionScopes.get(tabId) ?? scope);
  const open = session.status === 'open';

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [session.log.length]);

  useEffect(
    () => () => {
      void mqttDisconnect(tabId).catch(() => {});
      sessionScopes.delete(tabId);
    },
    [tabId],
  );

  const connect = async () => {
    patch(tabId, { status: 'connecting', error: null, subscribed: [] });
    try {
      const connectScope = await withResolvedSecretRefs(mqttTexts(request), scope, `MQTT ${request.url}`);
      sessionScopes.set(tabId, connectScope);
      await mqttConnect(tabId, request, connectScope, (event) => {
        if (event.kind === 'message') {
          append(tabId, {
            direction: 'received',
            topic: event.topic,
            text: event.text ?? `<binary, ${event.bytes} bytes> ${event.base64}`,
            qos: event.qos,
            retain: event.retain,
            bytes: event.bytes,
          });
        } else if (event.kind === 'disconnected') {
          patch(tabId, { status: 'closed', subscribed: [] });
          append(tabId, { direction: 'system', text: event.reason });
          useConsole.getState().log({ kind: 'ws-close', summary: `MQTT ${request.url} — ${event.reason}`, detail: event.reason, tabName: request.url });
        } else if (event.kind === 'subscribed' && event.granted.some((g) => g.toLowerCase().includes('failure'))) {
          append(tabId, { direction: 'system', text: `The broker refused a subscription (${event.granted.join(', ')})` });
        }
      });
      patch(tabId, { status: 'open' });
      append(tabId, { direction: 'system', text: `Connected to ${resolveVar(request.url, connectScope)}` });
      useConsole.getState().log({ kind: 'ws-connect', summary: `MQTT connected ${request.url}`, detail: request.url, tabName: request.url });
      const subscribed: string[] = [];
      for (const s of request.subscriptions.filter((s) => s.topic.trim())) {
        const topic = resolveVar(s.topic, connectScope);
        await mqttSubscribe(tabId, topic, s.qos);
        subscribed.push(topic);
      }
      patch(tabId, { subscribed });
      if (subscribed.length) append(tabId, { direction: 'system', text: `Subscribed to ${subscribed.join(', ')}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patch(tabId, { status: 'error', error: message });
      toast.error('Could not connect', message);
    }
  };

  const disconnect = async () => {
    await mqttDisconnect(tabId).catch(() => {});
    patch(tabId, { status: 'closed', subscribed: [] });
  };

  const addSubscription = async () => {
    const topic = newTopic.trim();
    if (!topic) return;
    set({ subscriptions: [...request.subscriptions, { topic, qos: 0 }] });
    setNewTopic('');
    if (open) {
      try {
        await mqttSubscribe(tabId, r(topic), 0);
        patch(tabId, { subscribed: [...session.subscribed, r(topic)] });
        append(tabId, { direction: 'system', text: `Subscribed to ${r(topic)}` });
      } catch (err) {
        toast.error('Subscribe failed', String(err));
      }
    }
  };

  const removeSubscription = async (index: number) => {
    const topic = request.subscriptions[index].topic;
    set({ subscriptions: request.subscriptions.filter((_, i) => i !== index) });
    if (open) {
      await mqttUnsubscribe(tabId, r(topic)).catch(() => {});
      patch(tabId, { subscribed: session.subscribed.filter((t) => t !== r(topic)) });
      append(tabId, { direction: 'system', text: `Unsubscribed from ${r(topic)}` });
    }
  };

  const publish = async () => {
    const topic = r(request.publishTopic).trim();
    if (!topic) {
      toast.error('No topic', 'Enter the topic to publish to.');
      return;
    }
    const payload = r(request.publishPayload);
    try {
      await mqttPublish(tabId, topic, payload, request.publishQos, request.publishRetain);
      append(tabId, { direction: 'sent', topic, text: payload, qos: request.publishQos, retain: request.publishRetain, bytes: new TextEncoder().encode(payload).length });
    } catch (err) {
      toast.error('Publish failed', String(err));
    }
  };

  if (!mqttAvailable()) {
    return <EmptyState title="MQTT needs the desktop app" detail="Browsers can't open the TCP or TLS connections MQTT brokers use." />;
  }

  const visible = filter.trim() ? session.log.filter((e) => !e.topic || topicMatches(filter.trim(), e.topic)) : session.log;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="rounded bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent">MQTT</span>
        <input
          value={request.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="mqtt://localhost:1883 · mqtts:// · ws:// · wss://"
          onKeyDown={(e) => e.key === 'Enter' && !open && connect()}
          className="h-9 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-[12.5px] focus:border-accent focus:outline-none"
        />
        {open || session.status === 'connecting' ? (
          <Button variant="danger" onClick={disconnect} disabled={session.status === 'connecting'}>
            <Unplug size={13} /> Disconnect
          </Button>
        ) : (
          <Button variant="primary" onClick={connect} disabled={!request.url.trim()}>
            <Plug size={13} /> Connect
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-line px-3">
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'messages', label: 'Messages', count: session.log.filter((e) => e.direction === 'received').length },
            { value: 'connection', label: 'Connection' },
          ]}
        />
        <Badge tone={STATUS_TONE[session.status]} title={session.error ?? undefined}>
          {STATUS_LABEL[session.status]}
        </Badge>
      </div>

      {section === 'connection' && (
        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-3 sm:grid-cols-2">
          <Field label="Client ID">
            <input value={request.clientId} onChange={(e) => set({ clientId: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Keep alive (s)">
            <Input type="number" min={5} value={request.keepAliveSecs} onChange={(e) => set({ keepAliveSecs: Math.max(5, Number(e.target.value) || 30) })} />
          </Field>
          <Field label="Username">
            <input value={request.username} onChange={(e) => set({ username: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Password">
            <input type="password" value={request.password} onChange={(e) => set({ password: e.target.value })} placeholder="{{mqttPassword}}" className={INPUT} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox checked={request.cleanSession} onChange={(cleanSession) => set({ cleanSession })} label="Clean session" hint="Off keeps your subscriptions and queued QoS 1/2 messages on the broker between connections (needs a fixed client ID)." />
          </div>
          <Field label="CA certificate (PEM)" hint="For mqtts:// / wss:// with a private CA." className="sm:col-span-2">
            <textarea value={request.caCertPem ?? ''} onChange={(e) => set({ caCertPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} />
          </Field>
          <Field label="Client certificate (PEM)">
            <textarea value={request.clientCertPem ?? ''} onChange={(e) => set({ clientCertPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} />
          </Field>
          <Field label="Client key (PEM)">
            <textarea value={request.clientKeyPem ?? ''} onChange={(e) => set({ clientKeyPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} />
          </Field>
        </div>
      )}

      {section === 'messages' && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-3 py-2">
            <span className="text-[11px] text-faint">Subscriptions</span>
            {request.subscriptions.map((s, i) => (
              <span key={`${s.topic}-${i}`} className="flex items-center gap-1 rounded border border-line bg-surface-2 py-0.5 pl-2 pr-0.5 font-mono text-[11.5px]">
                {s.topic}
                {open ? (
                  <span className="px-1 text-[10.5px] text-faint">QoS {s.qos}</span>
                ) : (
                  <select
                    aria-label={`QoS for ${s.topic}`}
                    value={s.qos}
                    onChange={(e) => set({ subscriptions: request.subscriptions.map((x, j) => (j === i ? { ...x, qos: Number(e.target.value) as 0 | 1 | 2 } : x)) })}
                    className="bg-transparent text-[10.5px] text-faint"
                  >
                    <option value={0}>QoS 0</option>
                    <option value={1}>QoS 1</option>
                    <option value={2}>QoS 2</option>
                  </select>
                )}
                <IconButton label={`Unsubscribe ${s.topic}`} onClick={() => removeSubscription(i)}>
                  <X size={11} />
                </IconButton>
              </span>
            ))}
            <input
              aria-label="Topic to subscribe to"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSubscription()}
              placeholder="sensors/+/temp"
              className="h-6 w-36 rounded border border-line bg-surface px-1.5 font-mono text-[11.5px] focus:border-accent focus:outline-none"
            />
            <IconButton label="Add subscription" onClick={addSubscription}>
              <Plus size={12} />
            </IconButton>
            <input
              aria-label="Filter messages by topic"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter: a/+/b, #"
              className="ml-auto h-6 w-36 rounded border border-line bg-surface px-1.5 font-mono text-[11.5px] focus:border-accent focus:outline-none"
            />
          </div>

          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {visible.length === 0 ? (
              <EmptyState title="No messages yet" detail="Connect to receive messages on your subscriptions, or publish one below." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {visible.map((entry) =>
                  entry.direction === 'system' ? (
                    <div key={entry.id} className="text-center text-[11px] text-faint">{entry.text}</div>
                  ) : (
                    <div
                      key={entry.id}
                      className={clsx('rounded-md border px-2.5 py-1.5', entry.direction === 'sent' ? 'border-accent/25 bg-accent/8' : 'border-line bg-surface-2')}
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        {entry.direction === 'sent' ? <ArrowUp size={12} className="text-accent" /> : <ArrowDown size={12} className="text-info" />}
                        <span className="font-mono text-dim">{entry.topic}</span>
                        <span className="text-faint">QoS {entry.qos}{entry.retain ? ' · retained' : ''} · {entry.bytes} B</span>
                        <span className="ml-auto text-[10px] text-faint">{new Date(entry.at).toLocaleTimeString()}</span>
                      </div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-fg">{prettyIfJson(entry.text)}</pre>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 border-t border-line p-3">
            <Field label="Topic" className="w-48">
              <input aria-label="Publish topic" value={request.publishTopic} onChange={(e) => set({ publishTopic: e.target.value })} placeholder="devices/42/cmd" className={INPUT} />
            </Field>
            <Field label="Payload" className="flex-1">
              <input
                aria-label="Payload"
                value={request.publishPayload}
                onChange={(e) => set({ publishPayload: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && open && publish()}
                placeholder='{"on": true}'
                className={INPUT}
              />
            </Field>
            <Field label="QoS" className="w-20">
              <Select value={request.publishQos} onChange={(e) => set({ publishQos: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>0</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
              </Select>
            </Field>
            <div className="pb-1.5">
              <Checkbox checked={request.publishRetain} onChange={(publishRetain) => set({ publishRetain })} label="Retain" />
            </div>
            <Button variant="primary" onClick={publish} disabled={!open}>
              <Send size={13} /> Publish
            </Button>
            <Button onClick={() => clear(tabId)} title="Clear message log">
              <Trash2 size={13} />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function prettyIfJson(text: string): string {
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return text;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}
