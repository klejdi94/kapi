import { Channel, invoke } from '@tauri-apps/api/core';
import type { MqttRequestDef } from '@/types';
import { isDesktop } from './transport';
import { resolve, type VarScope } from './variables';

/** Frontend side of MQTT (the Rust side is src-tauri/src/mqtt.rs). Native only — browsers can't open TCP sockets. */

export type MqttEvent =
  | { kind: 'connected'; sessionPresent: boolean }
  | { kind: 'message'; topic: string; text: string | null; base64: string | null; bytes: number; qos: number; retain: boolean; atMs: number }
  | { kind: 'subscribed'; granted: string[] }
  | { kind: 'disconnected'; reason: string };

export function mqttAvailable(): boolean {
  return isDesktop();
}

/** Every string in an MQTT request that `{{variables}}` are substituted into. */
export function mqttTexts(request: MqttRequestDef): string[] {
  return [
    request.url,
    request.clientId,
    request.username,
    request.password,
    request.publishTopic,
    request.publishPayload,
    ...request.subscriptions.map((s) => s.topic),
    request.caCertPem ?? '',
    request.clientCertPem ?? '',
    request.clientKeyPem ?? '',
  ];
}

export function mqttConnect(sessionId: string, request: MqttRequestDef, scope: VarScope, onEvent: (event: MqttEvent) => void): Promise<void> {
  const r = (t: string | undefined) => (t ? resolve(t, scope) : undefined);
  const events = new Channel<MqttEvent>();
  events.onmessage = onEvent;
  return invoke('kapi_mqtt_connect', {
    sessionId,
    config: {
      url: r(request.url),
      clientId: r(request.clientId) ?? '',
      username: r(request.username) || undefined,
      password: r(request.password) || undefined,
      keepAliveSecs: request.keepAliveSecs,
      cleanSession: request.cleanSession,
      caCertPem: r(request.caCertPem),
      clientCertPem: r(request.clientCertPem),
      clientKeyPem: r(request.clientKeyPem),
    },
    events,
  });
}

export const mqttSubscribe = (sessionId: string, topic: string, qosLevel: number) => invoke('kapi_mqtt_subscribe', { sessionId, topic, qosLevel });
export const mqttUnsubscribe = (sessionId: string, topic: string) => invoke('kapi_mqtt_unsubscribe', { sessionId, topic });
export const mqttPublish = (sessionId: string, topic: string, payload: string, qosLevel: number, retain: boolean) =>
  invoke('kapi_mqtt_publish', { sessionId, topic, payload, qosLevel, retain });
export const mqttDisconnect = (sessionId: string) => invoke('kapi_mqtt_disconnect', { sessionId });

/** MQTT topic filter matching (`+` one level, `#` the rest), for the log's filter box. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
