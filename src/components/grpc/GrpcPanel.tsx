import { useMemo, useState } from 'react';
import { FileCode2, Radar, Send, Square, Wand2 } from 'lucide-react';
import clsx from 'clsx';
import type { Collection, GrpcRequestDef } from '@/types';
import { Badge, Button, EmptyState, Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';
import { KVEditor } from '@/components/ui/KVEditor';
import { SplitPane } from '@/components/layout/Splitter';
import { useActiveWorkspace } from '@/store/workspaces';
import { useSession } from '@/store/session';
import { useConsole } from '@/store/console';
import { useGrpcCall, useGrpcCalls } from '@/store/grpcCalls';
import { buildScope } from '@/lib/variables';
import {
  callGrpc,
  cancelGrpc,
  findMethod,
  grpcTexts,
  grpcAvailable,
  loadProtos,
  messageTemplate,
  methodKind,
  pickProtoFiles,
  reflectSchema,
  type GrpcSchema,
} from '@/lib/grpc';
import { toast } from '@/lib/toast';
import { withResolvedSecretRefs } from '@/lib/secretRefs';

const INPUT = 'h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none';

function MetadataTable({ rows, empty }: { rows: [string, string][]; empty: string }) {
  if (!rows.length) return <p className="px-3 py-2 text-[11.5px] text-faint">{empty}</p>;
  return (
    <table className="w-full text-[11.5px]">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-t border-line/60 first:border-t-0">
            <td className="w-1/3 px-3 py-1 align-top font-mono text-dim">{k}</td>
            <td className="break-all px-3 py-1 font-mono text-fg">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A gRPC request: pick a schema (server reflection or .proto files), a
 * service and method, write the message as JSON, and send. Streaming
 * responses appear message by message as they arrive.
 */
export function GrpcPanel({
  tabId,
  request,
  onChange,
  collection,
}: {
  tabId: string;
  request: GrpcRequestDef;
  onChange: (request: GrpcRequestDef) => void;
  collection: Collection | null;
}) {
  const workspace = useActiveWorkspace();
  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);
  const call = useGrpcCall(tabId);
  const patchCall = useGrpcCalls((s) => s.patch);
  const addMessage = useGrpcCalls((s) => s.addMessage);
  const splitLayout = useSession((s) => s.splitLayout);
  const splitRatio = useSession((s) => s.splitRatio);
  const setSession = useSession((s) => s.set);
  const [section, setSection] = useState<'message' | 'metadata' | 'settings'>('message');
  const [responseTab, setResponseTab] = useState<'messages' | 'headers' | 'trailers'>('messages');
  const [loadingSchema, setLoadingSchema] = useState(false);

  const set = (patch: Partial<GrpcRequestDef>) => onChange({ ...request, ...patch });
  const method = findMethod(request);
  const service = request.services.find((s) => s.name === request.service) ?? null;

  const applySchema = (schema: GrpcSchema, patch: Partial<GrpcRequestDef>) => {
    const keepService = schema.services.find((s) => s.name === request.service);
    const nextService = keepService ?? schema.services[0];
    const keepMethod = nextService?.methods.find((m) => m.name === request.method);
    const nextMethod = keepMethod ?? nextService?.methods[0];
    set({
      ...patch,
      descriptorSet: schema.descriptorSet,
      services: schema.services,
      service: nextService?.name ?? '',
      method: nextMethod?.name ?? '',
      // Keep what the user wrote when the method didn't change; otherwise start from its template.
      message: keepMethod || !nextMethod ? request.message : messageTemplate(nextMethod),
    });
    const count = schema.services.reduce((n, s) => n + s.methods.length, 0);
    toast.success('Schema loaded', `${schema.services.length} service${schema.services.length === 1 ? '' : 's'}, ${count} method${count === 1 ? '' : 's'}`);
  };

  const reflect = async () => {
    setLoadingSchema(true);
    try {
      const reflectScope = await withResolvedSecretRefs(grpcTexts(request), scope, `gRPC reflection ${request.url}`);
      applySchema(await reflectSchema(request, reflectScope), { schemaSource: 'reflection' });
    } catch (err) {
      toast.error('Reflection failed', String(err));
    } finally {
      setLoadingSchema(false);
    }
  };

  const chooseProtos = async () => {
    const paths = await pickProtoFiles();
    if (!paths.length) return;
    setLoadingSchema(true);
    try {
      applySchema(await loadProtos(paths), { schemaSource: 'proto', protoPaths: paths });
    } catch (err) {
      toast.error('Could not compile the .proto files', String(err));
    } finally {
      setLoadingSchema(false);
    }
  };

  const reloadProtos = async () => {
    if (!request.protoPaths.length) return chooseProtos();
    setLoadingSchema(true);
    try {
      applySchema(await loadProtos(request.protoPaths), {});
    } catch (err) {
      toast.error('Could not compile the .proto files', String(err));
    } finally {
      setLoadingSchema(false);
    }
  };

  const send = async () => {
    if (!method) {
      toast.error('No method selected', 'Load a schema, then pick a service and method.');
      return;
    }
    patchCall(tabId, { running: true, headers: [], messages: [], result: null, error: null, callId: null });
    setResponseTab('messages');
    const label = `${request.service}/${request.method}`;
    useConsole.getState().log({ kind: 'http-request', summary: `→ gRPC ${label} @ ${request.url}`, detail: request.message, tabName: label });
    try {
      const callScope = await withResolvedSecretRefs(grpcTexts(request), scope, `gRPC ${label}`);
      const handle = callGrpc(request, callScope, (event) => {
        if (event.kind === 'headers') patchCall(tabId, { headers: event.metadata });
        else addMessage(tabId, { json: event.json, atMs: event.atMs });
      });
      patchCall(tabId, { callId: handle.callId });
      const result = await handle.result;
      patchCall(tabId, { running: false, result, callId: null });
      useConsole.getState().log({
        kind: result.statusCode === 0 ? 'http-response' : 'http-error',
        summary: `← gRPC ${result.statusName} ${label} · ${result.messagesReceived} message${result.messagesReceived === 1 ? '' : 's'} · ${result.durationMs}ms`,
        detail: result.statusMessage,
        tabName: label,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      patchCall(tabId, { running: false, error: message, callId: null });
      useConsole.getState().log({ kind: 'http-error', summary: `✕ gRPC ${label}`, detail: message, tabName: label });
    }
  };

  const cancel = () => {
    if (call.callId) void cancelGrpc(call.callId);
  };

  if (!grpcAvailable()) {
    return <EmptyState title="gRPC needs the desktop app" detail="Browsers can't make native HTTP/2 gRPC calls — open this request in kapi's desktop app." />;
  }

  const serviceSelect = (
    <Select
      aria-label="Service"
      className="w-52 min-w-0"
      value={request.service}
      onChange={(e) => {
        const next = request.services.find((s) => s.name === e.target.value);
        const first = next?.methods[0];
        set({ service: e.target.value, method: first?.name ?? '', message: first ? messageTemplate(first) : request.message });
      }}
      disabled={!request.services.length}
    >
      {!request.services.length && <option value="">No schema loaded</option>}
      {request.services.map((s) => (
        <option key={s.name} value={s.name}>{s.name}</option>
      ))}
    </Select>
  );
  const methodSelect = (
    <Select
      aria-label="Method"
      className="w-64 min-w-0"
      value={request.method}
      onChange={(e) => {
        const next = service?.methods.find((m) => m.name === e.target.value);
        set({ method: e.target.value, message: next ? messageTemplate(next) : request.message });
      }}
      disabled={!service}
    >
      {service?.methods.map((m) => (
        <option key={m.name} value={m.name}>
          {m.name} — {methodKind(m)}
        </option>
      ))}
    </Select>
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <Segmented
          value={section}
          onChange={setSection}
          options={[
            { value: 'message', label: method?.clientStreaming ? 'Messages' : 'Message' },
            { value: 'metadata', label: 'Metadata', count: request.metadata.filter((m) => m.enabled && m.key).length },
            { value: 'settings', label: 'Settings' },
          ]}
        />
        {section === 'message' && method && (
          <Button size="sm" variant="ghost" onClick={() => set({ message: messageTemplate(method) })} title="Replace the message with an example built from the schema">
            <Wand2 size={12} /> Template
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === 'message' && (
          <div className="flex h-full flex-col">
            {method && (
              <p className="border-b border-line/60 px-3 py-1.5 text-[11px] text-faint">
                <span className="font-mono text-dim">{method.inputType}</span> → <span className="font-mono text-dim">{method.outputType}</span>
                {method.clientStreaming && ' · a JSON array: each element is sent as one message, in order'}
                {' · {{variables}} are substituted'}
              </p>
            )}
            <div className="min-h-0 flex-1">
              <CodeEditor value={request.message} onChange={(message) => set({ message })} language="json" />
            </div>
          </div>
        )}
        {section === 'metadata' && (
          <div className="p-3">
            <KVEditor rows={request.metadata} onChange={(metadata) => set({ metadata })} keyPlaceholder="authorization" valuePlaceholder="Bearer {{token}}" />
            <p className="mt-2 text-[11px] text-faint">Sent with every call, including reflection. Keys ending in <code>-bin</code> take base64 values.</p>
          </div>
        )}
        {section === 'settings' && (
          <div className="grid max-w-lg gap-3 p-3">
            <Field label="Deadline (ms)" hint="Sent as grpc-timeout; 0 for none.">
              <Input type="number" min={0} value={request.timeoutMs} onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <Field label="CA certificate (PEM)" hint="Trusted in addition to the system's roots — for a private CA. Used for https:// addresses.">
              <textarea value={request.caCertPem ?? ''} onChange={(e) => set({ caCertPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} placeholder="-----BEGIN CERTIFICATE----- or {{caCert}}" />
            </Field>
            <Field label="Client certificate (PEM)" hint="Mutual TLS: set both the certificate and its key.">
              <textarea value={request.clientCertPem ?? ''} onChange={(e) => set({ clientCertPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} placeholder="{{clientCert}}" />
            </Field>
            <Field label="Client key (PEM)">
              <textarea value={request.clientKeyPem ?? ''} onChange={(e) => set({ clientKeyPem: e.target.value })} rows={3} className={clsx(INPUT, 'h-auto py-1.5')} placeholder="{{clientKey}}" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );

  const result = call.result;
  const response = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        {call.running && <Badge tone="warn">{call.messages.length ? `Streaming · ${call.messages.length}` : 'Waiting…'}</Badge>}
        {result && (
          <>
            <Badge tone={result.statusCode === 0 ? 'ok' : 'danger'}>
              {result.statusCode} {result.statusName}
            </Badge>
            <span className="tnum text-[11.5px] text-faint">
              {result.messagesReceived} message{result.messagesReceived === 1 ? '' : 's'} · {result.durationMs}ms
            </span>
          </>
        )}
        {call.error && <Badge tone="danger">Failed</Badge>}
        <Segmented
          className="ml-auto"
          value={responseTab}
          onChange={setResponseTab}
          options={[
            { value: 'messages', label: 'Messages', count: call.messages.length },
            { value: 'headers', label: 'Headers', count: call.headers.length },
            { value: 'trailers', label: 'Trailers', count: result?.trailers.length ?? 0 },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {call.error && <p className="whitespace-pre-wrap p-3 font-mono text-[12px] text-danger">{call.error}</p>}
        {result && result.statusCode !== 0 && result.statusMessage && (
          <p className="border-b border-line/60 p-3 font-mono text-[12px] text-danger">{result.statusMessage}</p>
        )}
        {responseTab === 'messages' &&
          (call.messages.length ? (
            call.messages.map((m, i) => (
              <div key={i} className="border-b border-line/60">
                <div className="flex justify-between px-3 pt-1.5 text-[10.5px] text-faint">
                  <span>#{i + 1}</span>
                  <span className="tnum">+{m.atMs}ms</span>
                </div>
                <pre className="overflow-x-auto px-3 pb-2 font-mono text-[12px] text-fg">{m.json}</pre>
              </div>
            ))
          ) : (
            !call.running && !call.error && !result && <EmptyState title="Send the request to see the response" detail="Streaming responses appear here message by message." />
          ))}
        {responseTab === 'headers' && <MetadataTable rows={call.headers} empty="No response headers yet." />}
        {responseTab === 'trailers' && <MetadataTable rows={result?.trailers ?? []} empty="No trailers." />}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line p-3">
        <span className="rounded bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent">gRPC</span>
        <input value={request.url} onChange={(e) => set({ url: e.target.value })} placeholder="localhost:50051 or https://api.example.com" className={clsx(INPUT, 'h-9 flex-1')} />
        {call.running ? (
          <Button variant="danger" onClick={cancel}>
            <Square size={13} /> Cancel
          </Button>
        ) : (
          <Button variant="primary" onClick={send} disabled={!method}>
            <Send size={13} /> Invoke
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11.5px]">
        <span className="text-faint">Schema</span>
        <Button size="sm" variant={request.schemaSource === 'reflection' && request.services.length ? 'subtle' : 'ghost'} onClick={reflect} disabled={loadingSchema}>
          <Radar size={12} /> Server reflection
        </Button>
        <Button size="sm" variant={request.schemaSource === 'proto' && request.services.length ? 'subtle' : 'ghost'} onClick={chooseProtos} disabled={loadingSchema}>
          <FileCode2 size={12} /> .proto files…
        </Button>
        {request.schemaSource === 'proto' && request.protoPaths.length > 0 && (
          <button className="truncate text-faint hover:text-fg" onClick={reloadProtos} title={request.protoPaths.join('\n')}>
            {request.protoPaths.map((p) => p.split(/[\\/]/).pop()).join(', ')} · reload
          </button>
        )}
        {loadingSchema && <span className="text-faint">Loading…</span>}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {serviceSelect}
          {methodSelect}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitPane direction={splitLayout} ratio={splitRatio} onRatio={(v) => setSession('splitRatio', v)} first={editor} second={response} />
      </div>
    </div>
  );
}
