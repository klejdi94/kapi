import { isDesktop } from './transport';

/**
 * Downloads via `<a download>` never fire in the macOS webview — the click is
 * accepted and nothing lands on disk. On desktop we ask for a path with the
 * native save dialog and write the bytes ourselves; in a browser the anchor
 * trick is still the only option.
 *
 * Returns the chosen path on desktop, '' in the browser, or null if cancelled.
 */
export async function saveFile(
  suggestedName: string,
  data: Blob | string,
  mime = 'application/octet-stream',
): Promise<string | null> {
  if (!isDesktop()) {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return '';
  }

  const [{ save }, { invoke }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/core')]);
  const path = await save({ defaultPath: suggestedName });
  if (!path) return null;

  if (typeof data === 'string') {
    await invoke('kapi_write_text_file', { path, contents: data });
  } else {
    const bytes = Array.from(new Uint8Array(await data.arrayBuffer()));
    await invoke('kapi_write_binary_file', { path, contents: bytes });
  }
  return path;
}
