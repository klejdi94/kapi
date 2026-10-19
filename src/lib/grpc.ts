import { Channel, invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { GrpcMethodInfo, GrpcRequestDef, GrpcServiceInfo } from '@/types';
import { isDesktop } from './transport';
import { resolve, type VarScope } from './variables';
import { uid } from './factory';

/**
 * Frontend side of gRPC (the Rust side is src-tauri/src/grpc.rs): load a
 * schema from .proto files or server reflection, then call any method with
 * JSON messages. Native only — a browser can't speak HTTP/2 gRPC.
 */

export interface GrpcSchema {
  descriptorSet: string;
  services: GrpcServiceInfo[];
}

export type GrpcEvent = { kind: 'headers'; metadata: [string, string][] } | { kind: 'message'; json: string; atMs: number };

export interface GrpcCallResult {
  statusCode: number;
  statusName: string;
  statusMessage: string;
  headers: [string, string][];
  trailers: [string, string][];
  messagesReceived: number;
  durationMs: number;
}

export function grpcAvailable(): boolean {
  return isDesktop();
}

export function methodKind(method: Pick<GrpcMethodInfo, 'clientStreaming' | 'serverStreaming'>): 'unary' | 'server streaming' | 'client streaming' | 'bidirectional' {
  if (method.clientStreaming && method.serverStreaming) return 'bidirectional';
  if (method.clientStreaming) return 'client streaming';
  if (method.serverStreaming) return 'server streaming';
  return 'unary';
}

export function findMethod(request: Pick<GrpcRequestDef, 'services' | 'service' | 'method'>): GrpcMethodInfo | null {
  return request.services.find((s) => s.name === request.service)?.methods.find((m) => m.name === request.method) ?? null;
}

/** The editor text for a method: its template, wrapped in an array when the method takes a stream of messages. */
export function messageTemplate(method: GrpcMethodInfo): string {
  if (!method.clientStreaming) return method.inputTemplate;
  const indented = method.inputTemplate.split('\n').map((line) => `  ${line}`).join('\n');
  return `[\n${indented}\n]`;
}

/** Splits the editor text into the JSON messages to send — one, or each element of an array for streaming methods. */
export function messagesToSend(text: string, clientStreaming: boolean): string[] {
  const trimmed = text.trim() || '{}';
  if (!clientStreaming) return [trimmed];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`The messages aren't valid JSON: ${(err as Error).message}`);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length) throw new Error('Add at least one message to the array.');
  return list.map((m) => JSON.stringify(m));
}

function target(request: GrpcRequestDef, scope: VarScope) {
  return {
    url: resolve(request.url, scope),
    metadata: request.metadata.filter((m) => m.enabled && m.key.trim()).map((m) => [resolve(m.key, scope), resolve(m.value, scope)] as [string, string]),
    timeoutMs: request.timeoutMs || undefined,
    caCertPem: request.caCertPem ? resolve(request.caCertPem, scope) : undefined,
    clientCertPem: request.clientCertPem ? resolve(request.clientCertPem, scope) : undefined,
    clientKeyPem: request.clientKeyPem ? resolve(request.clientKeyPem, scope) : undefined,
  };
}

/** Every string in a gRPC request that `{{variables}}` are substituted into. */
export function grpcTexts(request: GrpcRequestDef): string[] {
  return [
    request.url,
    request.message,
    ...request.metadata.filter((m) => m.enabled).flatMap((m) => [m.key, m.value]),
    request.caCertPem ?? '',
    request.clientCertPem ?? '',
    request.clientKeyPem ?? '',
  ];
}

export async function pickProtoFiles(): Promise<string[]> {
  const selected = await openDialog({ multiple: true, title: 'Choose .proto files', filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }] });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export function loadProtos(paths: string[]): Promise<GrpcSchema> {
  return invoke<GrpcSchema>('kapi_grpc_load_protos', { paths });
}

export function reflectSchema(request: GrpcRequestDef, scope: VarScope): Promise<GrpcSchema> {
  return invoke<GrpcSchema>('kapi_grpc_reflect', { target: target(request, scope) });
}

export interface GrpcCallHandle {
  callId: string;
  result: Promise<GrpcCallResult>;
}

export function callGrpc(request: GrpcRequestDef, scope: VarScope, onEvent: (event: GrpcEvent) => void): GrpcCallHandle {
  const method = findMethod(request);
  if (!method) throw new Error('Pick a service and method first.');
  // {{variables}} work inside messages too, resolved before the JSON is parsed.
  const messages = messagesToSend(resolve(request.message, scope), method.clientStreaming);
  const callId = uid();
  const events = new Channel<GrpcEvent>();
  events.onmessage = onEvent;
  const result = invoke<GrpcCallResult>('kapi_grpc_call', {
    request: { callId, target: target(request, scope), descriptorSet: request.descriptorSet, service: request.service, method: request.method, messages },
    events,
  });
  return { callId, result };
}

export function cancelGrpc(callId: string): Promise<void> {
  return invoke('kapi_grpc_cancel', { callId });
}
