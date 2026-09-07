import { isDesktop } from './transport';
import type { Update } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
}

let pending: Update | null = null;

/** Resolves to null when no update is available or when not running as a desktop app. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isDesktop()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  pending = update;
  if (!update) return null;
  return { version: update.version, currentVersion: update.currentVersion, body: update.body };
}

/** Downloads and installs the update found by the last checkForUpdate() call, then relaunches. */
export async function downloadAndInstallUpdate(): Promise<void> {
  if (!pending) throw new Error('No update available — call checkForUpdate() first');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await pending.downloadAndInstall();
  await relaunch();
}
