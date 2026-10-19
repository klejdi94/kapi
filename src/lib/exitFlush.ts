import { isDesktop } from './transport';
import { flushPendingWrites } from './fileStorage';
import { vaultSavesSettled } from './vaultedStorage';

/** Long enough for a few local JSON writes; short enough that a stuck write never traps the user in the app. */
const FLUSH_BUDGET_MS = 3000;

function flushWithBudget(): Promise<void> {
  const flushed = vaultSavesSettled().then(() => flushPendingWrites());
  return Promise.race([flushed, new Promise<void>((resolve) => setTimeout(resolve, FLUSH_BUDGET_MS))]);
}

/**
 * Edits are saved on a short debounce (see fileStorage.ts), so closing the
 * window or quitting right after a change used to race the last write —
 * `beforeunload` can't wait for an async IPC call. Instead:
 * - closing the window waits for pending writes, then destroys it;
 * - the app menu's Quit (⌘Q / Ctrl+Q) is kapi's own item, which lands here
 *   and exits only once the writes are done.
 */
export async function installExitFlush(): Promise<void> {
  if (!isDesktop()) return;
  const [{ getCurrentWindow }, { listen }, { exit }] = await Promise.all([
    import('@tauri-apps/api/window'),
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-process'),
  ]);
  await getCurrentWindow().onCloseRequested(async () => {
    await flushWithBudget();
  });
  await listen<string>('kapi://menu', async (event) => {
    if (event.payload !== 'quit') return;
    await flushWithBudget();
    await exit(0);
  });
}
