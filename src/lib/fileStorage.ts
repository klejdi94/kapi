import type { StateStorage } from 'zustand/middleware';
import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, pathExists } from './fs';
import { isDesktop } from './transport';
import { toast } from './toast';

/**
 * Every zustand store persists here instead of `localStorage`: one JSON file
 * per store, in the OS's own per-app data directory
 * (`~/Library/Application Support/com.klejdi94.kapi` on macOS). This is what
 * "everything is stored only on this machine" is backed by now that kapi is a
 * desktop app — a real, inspectable file on disk rather than opaque webview
 * storage capped at a few MB. `writeTextFile` (see fs.ts / lib.rs) already
 * creates the directory on first write, so there's no separate mkdir step.
 *
 * Writes are debounced per key and skipped when the content hasn't actually
 * changed, since zustand's persist middleware calls setItem on every state
 * change, including ones that don't need a disk write.
 */
const DEBOUNCE_MS = 400;
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; value: string }>();
const lastWritten = new Map<string, string>();
let dataDirPromise: Promise<string> | null = null;
let warnedUnavailable = false;

function dataDir(): Promise<string> {
  if (!dataDirPromise) dataDirPromise = appDataDir();
  return dataDirPromise;
}

async function filePath(name: string): Promise<string> {
  return join(await dataDir(), `${name}.json`);
}

function flush(name: string, value: string) {
  pending.delete(name);
  if (lastWritten.get(name) === value) return;
  filePath(name)
    .then((path) => writeTextFile(path, value))
    .then(() => lastWritten.set(name, value))
    .catch((err) => {
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        toast.error('Could not save to disk', (err as Error).message);
      }
    });
}

export const fileJSONStorage: StateStorage = {
  getItem: async (name) => {
    if (!isDesktop()) return null; // no persistence outside the desktop shell
    try {
      const path = await filePath(name);
      if (!(await pathExists(path))) return null;
      const text = await readTextFile(path);
      lastWritten.set(name, text);
      return text || null;
    } catch {
      return null;
    }
  },

  setItem: (name, value) => {
    if (!isDesktop()) return;
    const existing = pending.get(name);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => flush(name, value), DEBOUNCE_MS);
    pending.set(name, { timer, value });
  },

  removeItem: (name) => {
    if (!isDesktop()) return;
    const existing = pending.get(name);
    if (existing) clearTimeout(existing.timer);
    pending.delete(name);
    flush(name, '');
  },
};

/** Forces every debounced write out immediately — call before the window closes. */
export function flushPendingWrites() {
  for (const [name, { timer, value }] of pending) {
    clearTimeout(timer);
    flush(name, value);
  }
}

const STORE_NAMES = ['kapi.workspaces', 'kapi.session', 'kapi.history'];

/** Total on-disk size of kapi's own data files, for the status bar. */
export async function estimateDiskUsageBytes(): Promise<number> {
  if (!isDesktop()) return 0;
  try {
    const sizes = await Promise.all(
      STORE_NAMES.map(async (name) => {
        const cached = lastWritten.get(name);
        if (cached !== undefined) return cached.length;
        const path = await filePath(name);
        if (!(await pathExists(path))) return 0;
        const text = await readTextFile(path).catch(() => '');
        return text.length;
      }),
    );
    return sizes.reduce((sum, n) => sum + n, 0) * 2; // UTF-16 code units
  } catch {
    return 0;
  }
}

export async function dataDirectoryPath(): Promise<string> {
  return dataDir();
}
