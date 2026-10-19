import type { KV } from '@/types';

/**
 * Secret-flagged variables, encrypted at rest.
 *
 * `kapi.workspaces.json` keeps every variable row as before, except that a
 * secret row's value is blanked and marked `secretInVault`. The real values
 * live in `kapi.secrets.json`, AES-256-GCM-encrypted with a key held in the OS
 * credential store (see `src-tauri/src/secrets.rs`). Nothing here touches the
 * keychain or the filesystem directly — callers pass the key and do the I/O —
 * so the same code runs in the app (WebCrypto in the webview) and in the MCP
 * server (Node's WebCrypto).
 */

/** Row id → secret value. */
export type SecretMap = Record<string, string>;

export interface VaultFile {
  v: 1;
  iv: string;
  data: string;
}

const AAD = new TextEncoder().encode('kapi.secrets.v1');

interface WorkspaceLike {
  globals?: KV[];
  environments?: { variables?: KV[] }[];
  collections?: { variables?: KV[] }[];
}

/** Every variable row that can carry the secret flag, across all workspaces. */
function secretCapableRows(state: unknown): KV[] {
  const workspaces = (state as { workspaces?: WorkspaceLike[] } | null)?.workspaces;
  if (!Array.isArray(workspaces)) return [];
  const rows: KV[] = [];
  for (const ws of workspaces) {
    if (Array.isArray(ws.globals)) rows.push(...ws.globals);
    for (const env of ws.environments ?? []) if (Array.isArray(env.variables)) rows.push(...env.variables);
    for (const col of ws.collections ?? []) if (Array.isArray(col.variables)) rows.push(...col.variables);
  }
  return rows.filter((row) => row && typeof row === 'object');
}

/** True when a persisted store text references the vault (cheap pre-check before parsing). */
export function referencesVault(text: string): boolean {
  return text.includes('"secretInVault"');
}

/**
 * Moves secret values out of a persisted `{state, version}` envelope.
 * Rows still waiting on a value the vault couldn't supply (`secretInVault`
 * with an empty value) keep their previous vault entry, so a locked keychain
 * at startup never turns into a lost secret on the next save.
 */
export function extractSecrets(envelopeText: string, previous: SecretMap): { text: string; secrets: SecretMap; count: number } {
  const envelope = JSON.parse(envelopeText) as { state?: unknown };
  const secrets: SecretMap = {};
  let count = 0;
  for (const row of secretCapableRows(envelope.state)) {
    if (row.secret) {
      if (row.value) {
        secrets[row.id] = row.value;
      } else if (row.secretInVault && row.id in previous) {
        secrets[row.id] = previous[row.id];
      } else if (row.secretInVault) {
        // Unresolved and not in the vault either: leave the marker so the
        // row never silently turns into an ordinary empty variable.
        continue;
      } else {
        continue;
      }
      row.value = '';
      row.secretInVault = true;
      count++;
    } else {
      delete row.secretInVault;
    }
  }
  return { text: JSON.stringify(envelope), secrets, count };
}

/** Puts vault values back into a persisted envelope. A value already in the file (e.g. written by the MCP server) wins. */
export function injectSecrets(envelopeText: string, secrets: SecretMap): { text: string; missing: number } {
  const envelope = JSON.parse(envelopeText) as { state?: unknown };
  let missing = 0;
  for (const row of secretCapableRows(envelope.state)) {
    if (!row.secretInVault) continue;
    if (!row.value && row.id in secrets) row.value = secrets[row.id];
    if (row.value) delete row.secretInVault;
    else missing++;
  }
  return { text: JSON.stringify(envelope), missing };
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
