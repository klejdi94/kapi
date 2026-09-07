import { join } from 'node:path';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ensureDataDir } from './dataDir.ts';

/**
 * The on-disk shape every `zustand/persist` store in the GUI app writes
 * (see `src/lib/fileStorage.ts`) — `{state: {...}, version}`. This process
 * has no zustand store of its own, so it reads/writes that envelope by hand.
 */
interface PersistEnvelope<T> {
  state: T;
  version: number;
}

/**
 * Reads a store file fresh every call (no caching — unlike the GUI app,
 * which only reads once at hydration, this process is short-lived per MCP
 * tool call and must always see the latest state, including writes made by
 * the GUI app or a previous tool call a second ago).
 */
export async function readStore<T>(name: string, fallback: T): Promise<T> {
  const dir = await ensureDataDir();
  const path = join(dir, `${name}.json`);
  try {
    const text = await readFile(path, 'utf-8');
    if (!text.trim()) return fallback;
    const parsed = JSON.parse(text) as PersistEnvelope<T>;
    return parsed.state ?? fallback;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

/**
 * Read-modify-write with an atomic write (temp file + rename) so a reader
 * (this process, the GUI app, or another concurrent MCP call) never
 * observes a half-written file. Still a race if the GUI app writes between
 * this function's read and its write — mitigated, not eliminated, by the
 * GUI's own focus-reload check (`src/lib/fileStorage.ts`'s
 * `peekExternalChange`), which is why every mutating MCP tool tells the
 * caller to bring kapi to the foreground to pick up the change safely.
 */
export async function updateStore<T>(name: string, fallback: T, mutate: (current: T) => T, version = 1): Promise<T> {
  const dir = await ensureDataDir();
  const path = join(dir, `${name}.json`);
  const current = await readStore(name, fallback);
  const next = mutate(current);
  const envelope: PersistEnvelope<T> = { state: next, version };
  const tmpPath = join(dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(tmpPath, JSON.stringify(envelope), 'utf-8');
  try {
    await rename(tmpPath, path);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
  return next;
}

export const STORE_WORKSPACES = 'kapi.workspaces';
export const STORE_RUN_HISTORY = 'kapi.run-history';
export const STORE_OPENAPI_HISTORY = 'kapi.openapi-history';

/** Shown at the end of every tool response that wrote to disk. */
export const RELOAD_HINT =
  'If kapi is currently open, bring its window to the foreground — it reloads automatically when it notices the file changed.';
