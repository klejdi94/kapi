import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Mirrors Tauri's `appDataDir()` resolution for identifier `com.klejdi94.kapi`
 * (see `src-tauri/tauri.conf.json`) without depending on Tauri at all — this
 * process is a plain Node script, spawned by an AI CLI over stdio, that may
 * run with kapi not even installed. Kept in lockstep by hand since there's
 * no shared source of truth between the Rust/JS app and this script.
 *
 * `KAPI_MCP_DEV=1` mirrors `src/lib/fileStorage.ts`'s dev/production split
 * (an extra `dev` subfolder) so this server can be exercised against
 * throwaway data instead of a real workspace while developing it.
 */
function baseDataDir(): string {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'com.klejdi94.kapi');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'com.klejdi94.kapi');
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'com.klejdi94.kapi');
  }
}

export function dataDir(): string {
  const base = baseDataDir();
  return process.env.KAPI_MCP_DEV === '1' ? join(base, 'dev') : base;
}

export async function ensureDataDir(): Promise<string> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Best-effort check for a real kapi install, purely to point a user at it when it's missing. */
export function findAppInstall(): string | null {
  const candidates: string[] =
    process.platform === 'darwin'
      ? ['/Applications/kapi.app', join(homedir(), 'Applications', 'kapi.app')]
      : process.platform === 'win32'
        ? [join(process.env.LOCALAPPDATA ?? '', 'kapi', 'kapi.exe'), join(process.env.PROGRAMFILES ?? '', 'kapi', 'kapi.exe')]
        : ['/usr/bin/kapi', '/usr/local/bin/kapi', join(homedir(), '.local', 'bin', 'kapi')];
  // Deliberately synchronous + best-effort: this only feeds a friendly
  // status message, never a hard gate on anything else this server does.
  for (const path of candidates) {
    try {
      if (path && existsSync(path)) return path;
    } catch {
      // ignore
    }
  }
  return null;
}

export const KAPI_RELEASES_URL = 'https://github.com/klejdi94/kapi/releases/latest';
