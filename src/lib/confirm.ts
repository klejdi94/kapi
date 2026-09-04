import { isDesktop } from './transport';

/**
 * `window.confirm` is a no-op in the macOS webview — it returns false without
 * ever showing anything, which silently swallows every action gated on it.
 * On desktop we ask through Tauri's native dialog instead.
 */
export async function confirmAction(
  message: string,
  options: { title?: string; okLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  if (!isDesktop()) return window.confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, {
    title: options.title ?? 'kapi',
    kind: options.danger ? 'warning' : 'info',
    okLabel: options.okLabel ?? 'OK',
    cancelLabel: 'Cancel',
  });
}
