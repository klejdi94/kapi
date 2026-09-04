import { invoke } from '@tauri-apps/api/core';

/**
 * Thin wrappers around the app's own `kapi_*` commands (see `src-tauri/src/lib.rs`).
 * Reads/writes go straight to disk at a path the user chose through the native
 * folder picker — there's no ACL scope to configure because that choice is
 * already the trust boundary, same as any other desktop app's "Open Folder".
 */
export async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke('kapi_write_text_file', { path, contents });
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('kapi_read_text_file', { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>('kapi_path_exists', { path });
}

export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter(Boolean)
    .join('/');
}
