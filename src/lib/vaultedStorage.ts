import type { StateStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { fileJSONStorage } from './fileStorage';
import { pathExists, readTextFile, writeTextFile } from './fs';
import { decryptVault, encryptVault, extractSecrets, injectSecrets, mergeVault, referencesVault, sameSecrets, type SecretMap } from './secretVault';
import { isDesktop } from './transport';
import { toast } from './toast';

/**
 * Wraps the file storage of every store that can hold secrets (workspaces,
 * open tabs, history) so they're written to the encrypted vault
 * (`kapi.secrets.json`) instead of the plain store files. See lib/secretVault.ts for the format and the Rust side for
 * where the key lives.
 *
 * If the key can't be obtained (keychain prompt denied, no Secret Service on a
 * minimal Linux desktop) or the vault can't be decrypted, kapi keeps working
 * exactly as before — secrets stay in the workspace file — and says so once.
 * It never writes a vault it couldn't first read, so a transient failure can't
 * destroy stored secrets.
 */

let keyPromise: Promise<string> | null = null;
/** The vault as last read or written; `null` until it has been read successfully. */
let knownVault: SecretMap | null = null;
let warned = false;
let queue: Promise<void> = Promise.resolve();

async function vaultPath(): Promise<string> {
  const dir = await appDataDir();
  return join(import.meta.env.DEV ? await join(dir, 'dev') : dir, 'kapi.secrets.json');
}

function getKey(): Promise<string> {
  if (!keyPromise) {
    keyPromise = invoke<string>('kapi_secrets_key').catch((err) => {
      keyPromise = null; // retry next time — the user may unlock the keychain
      throw err;
    });
  }
  return keyPromise;
}

function warnOnce(detail: string) {
  if (warned) return;
  warned = true;
  toast.error('Secret variables are not encrypted', `${detail} They stay in the workspace file on disk, as before.`);
}

/** Reads the vault, or returns null when it (or the key) isn't available right now. */
async function loadVault(): Promise<SecretMap | null> {
  if (knownVault) return knownVault;
  try {
    const key = await getKey();
    const path = await vaultPath();
    knownVault = (await pathExists(path)) ? await decryptVault(await readTextFile(path), key) : {};
    return knownVault;
  } catch (err) {
    warnOnce(`kapi couldn't open its key in the system keychain (${err instanceof Error ? err.message : String(err)}).`);
    return null;
  }
}

async function save(name: string, value: string): Promise<void> {
  const vault = await loadVault();
  if (!vault) {
    fileJSONStorage.setItem(name, value);
    return;
  }
  const { text, secrets } = extractSecrets(value, vault, name);
  const next = mergeVault(vault, name, secrets);
  if (!sameSecrets(next, vault)) {
    try {
      const encrypted = await encryptVault(next, await getKey());
      // Written before the store file, so the file never references a value the vault doesn't hold.
      await writeTextFile(await vaultPath(), JSON.stringify(encrypted), { backup: true });
      knownVault = next;
    } catch (err) {
      warnOnce(`Saving the encrypted secrets file failed (${err instanceof Error ? err.message : String(err)}).`);
      fileJSONStorage.setItem(name, value);
      return;
    }
  }
  fileJSONStorage.setItem(name, text);
}

export const vaultedStorage: StateStorage = {
  getItem: async (name) => {
    const text = await fileJSONStorage.getItem(name);
    if (!text || !isDesktop() || !referencesVault(text)) return text;
    const vault = await loadVault();
    if (!vault) return text;
    const { text: injected, missing } = injectSecrets(text, vault, name);
    if (missing) toast.error('Some secret values are missing', `${missing} secret value${missing === 1 ? '' : 's'} could not be found in the encrypted secrets file.`);
    return injected;
  },
  setItem: (name, value) => {
    if (!isDesktop()) return;
    // Serialised: an older save finishing after a newer one must never win.
    queue = queue.then(() => save(name, value)).catch(() => {});
    return queue;
  },
  removeItem: (name) => fileJSONStorage.removeItem(name),
};

/** Resolves once every queued save has reached the (debounced) file layer. */
export function vaultSavesSettled(): Promise<void> {
  return queue;
}
