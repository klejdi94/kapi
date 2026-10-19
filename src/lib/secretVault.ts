import type { AuthConfig, Collection, KV, MqttRequestDef } from '@/types';
import { AUTH_SECRET_FIELDS, collectionAuths, collectionMqtt, getAuthField, isLiteralSecret, setAuthField } from './secretFields';

/**
 * Secrets, encrypted at rest: secret-flagged variables and the credential
 * fields of auth configs (see secretFields.ts), in the workspace file, open
 * tabs and request history.
 *
 * The store files keep their shape, except that each such value is blanked
 * and marked (`secretInVault` on a variable row, `vaulted` on an auth config).
 * The real values live in `kapi.secrets.json`, AES-256-GCM-encrypted with a
 * key held in the OS credential store (see `src-tauri/src/secrets.rs`). Nothing here touches the
 * keychain or the filesystem directly — callers pass the key and do the I/O —
 * so the same code runs in the app (WebCrypto in the webview) and in the MCP
 * server (Node's WebCrypto).
 */

/** Vault key → secret value. Keys are namespaced by store: `kapi.workspaces/var/<rowId>`, `kapi.session/auth/<tabId>/bearer.token`… */
export type SecretMap = Record<string, string>;

export interface VaultFile {
  v: 1;
  iv: string;
  data: string;
}

const AAD = new TextEncoder().encode('kapi.secrets.v1');

/** One place a secret can live inside a persisted store. */
interface Slot {
  key: string;
  get(): string;
  set(value: string): void;
  /** Whether the current value should be kept out of the file. */
  shouldVault(value: string): boolean;
  marked(): boolean;
  mark(on: boolean): void;
}

interface WorkspaceLike {
  globals?: KV[];
  environments?: { variables?: KV[] }[];
  collections?: Collection[];
}

function variableSlots(ns: string, rows: KV[] | undefined): Slot[] {
  return (rows ?? [])
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      key: `${ns}/var/${row.id}`,
      get: () => row.value ?? '',
      set: (value) => {
        row.value = value;
      },
      shouldVault: (value) => !!row.secret && !!value,
      marked: () => !!row.secretInVault,
      mark: (on) => {
        if (on) row.secretInVault = true;
        else delete row.secretInVault;
      },
    }));
}

function mqttSlot(ns: string, ownerId: string, request: MqttRequestDef | null | undefined): Slot[] {
  if (!request || typeof request !== 'object') return [];
  return [
    {
      key: `${ns}/mqtt/${ownerId}/password`,
      get: () => request.password ?? '',
      set: (value) => {
        request.password = value;
      },
      shouldVault: isLiteralSecret,
      marked: () => !!request.passwordInVault,
      mark: (on) => {
        if (on) request.passwordInVault = true;
        else delete request.passwordInVault;
      },
    },
  ];
}

function authSlots(ns: string, ownerId: string, auth: AuthConfig | undefined): Slot[] {
  if (!auth || typeof auth !== 'object') return [];
  return AUTH_SECRET_FIELDS.map((field) => ({
    key: `${ns}/auth/${ownerId}/${field}`,
    get: () => getAuthField(auth, field),
    set: (value) => setAuthField(auth, field, value),
    shouldVault: isLiteralSecret,
    marked: () => !!auth.vaulted?.includes(field),
    mark: (on) => {
      const rest = (auth.vaulted ?? []).filter((f) => f !== field);
      if (on) rest.push(field);
      if (rest.length) auth.vaulted = rest;
      else delete auth.vaulted;
    },
  }));
}

/** Every secret slot in a persisted store's state, by store name. Stores not listed here hold no secrets. */
function slotsFor(ns: string, state: unknown): Slot[] {
  const slots: Slot[] = [];
  const s = state as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return slots;
  if (ns === 'kapi.workspaces' && Array.isArray(s.workspaces)) {
    for (const ws of s.workspaces as WorkspaceLike[]) {
      slots.push(...variableSlots(ns, ws.globals));
      for (const env of ws.environments ?? []) slots.push(...variableSlots(ns, env.variables));
      for (const collection of ws.collections ?? []) {
        slots.push(...variableSlots(ns, collection.variables));
        for (const { ownerId, auth } of collectionAuths(collection)) slots.push(...authSlots(ns, ownerId, auth));
        for (const { ownerId, request } of collectionMqtt(collection)) slots.push(...mqttSlot(ns, ownerId, request));
      }
    }
  }
  if (ns === 'kapi.session' && Array.isArray(s.tabs)) {
    for (const tab of s.tabs as { id: string; request?: { auth?: AuthConfig }; mqtt?: MqttRequestDef | null }[]) {
      slots.push(...authSlots(ns, tab.id, tab.request?.auth));
      slots.push(...mqttSlot(ns, tab.id, tab.mqtt));
    }
  }
  if (ns === 'kapi.history' && Array.isArray(s.entries)) {
    for (const entry of s.entries as { id: string; request?: { auth?: AuthConfig } }[]) slots.push(...authSlots(ns, entry.id, entry.request?.auth));
  }
  return slots;
}

/** Store names whose files can contain secrets (and so go through the vault). */
export const VAULTED_STORES = ['kapi.workspaces', 'kapi.session', 'kapi.history'];

/** True when a persisted store text references the vault (cheap pre-check before parsing). */
export function referencesVault(text: string): boolean {
  return text.includes('"secretInVault"') || text.includes('"vaulted"') || text.includes('"passwordInVault"');
}

/**
 * Moves secrets out of a persisted `{state, version}` envelope for store `ns`.
 * Returns the secrets under their vault keys. Slots still waiting on a value
 * the vault couldn't supply (marked, but empty) keep their previous vault
 * entry, so a locked keychain at startup never turns into a lost secret on
 * the next save.
 */
export function extractSecrets(envelopeText: string, previous: SecretMap, ns: string): { text: string; secrets: SecretMap; count: number } {
  const envelope = JSON.parse(envelopeText) as { state?: unknown };
  const secrets: SecretMap = {};
  let count = 0;
  for (const slot of slotsFor(ns, envelope.state)) {
    const value = slot.get();
    if (slot.shouldVault(value)) {
      secrets[slot.key] = value;
      slot.set('');
      slot.mark(true);
      count++;
    } else if (!value && slot.marked()) {
      // Unresolved: carry the stored value forward, and keep the marker either
      // way so it never silently turns into an ordinary empty field.
      if (slot.key in previous) secrets[slot.key] = previous[slot.key];
    } else {
      slot.mark(false);
    }
  }
  return { text: JSON.stringify(envelope), secrets, count };
}

/** Puts vault values back into a persisted envelope. A value already in the file (e.g. written by the MCP server) wins. */
export function injectSecrets(envelopeText: string, secrets: SecretMap, ns: string): { text: string; missing: number } {
  const envelope = JSON.parse(envelopeText) as { state?: unknown };
  let missing = 0;
  for (const slot of slotsFor(ns, envelope.state)) {
    if (!slot.marked()) continue;
    if (!slot.get() && slot.key in secrets) slot.set(secrets[slot.key]);
    if (slot.get()) slot.mark(false);
    else missing++;
  }
  return { text: JSON.stringify(envelope), missing };
}

/** The vault after store `ns` saved `secrets`: its own entries replaced, every other store's kept. */
export function mergeVault(vault: SecretMap, ns: string, secrets: SecretMap): SecretMap {
  const out: SecretMap = {};
  for (const [key, value] of Object.entries(vault)) if (!key.startsWith(`${ns}/`)) out[key] = value;
  return { ...out, ...secrets };
}

export function sameSecrets(a: SecretMap, b: SecretMap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && a[k] === b[k]);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid secrets key');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(secrets: SecretMap, keyHex: string): Promise<VaultFile> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const cipher = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, await importKey(keyHex), plain);
  return { v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

export async function decryptVault(text: string, keyHex: string): Promise<SecretMap> {
  const file = JSON.parse(text) as VaultFile;
  if (file?.v !== 1 || typeof file.iv !== 'string' || typeof file.data !== 'string') throw new Error('Unrecognised secrets file');
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(file.iv), additionalData: AAD },
    await importKey(keyHex),
    fromBase64(file.data),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as unknown;
  const out: SecretMap = {};
  if (parsed && typeof parsed === 'object') for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
  return out;
}
