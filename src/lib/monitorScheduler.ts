import { useWorkspaces } from '@/store/workspaces';
import { useRunHistory } from '@/store/runHistory';
import { useConsole } from '@/store/console';
import { isDesktop } from './transport';
import { toast } from './toast';
import { isDue, runMonitor, shouldNotify } from './monitors';
import { compareRecentToHistory } from './regression';
import type { Monitor } from '@/types';

const TICK_MS = 30_000;
const running = new Set<string>();

async function notify(title: string, body: string) {
  if (!isDesktop()) {
    toast.error(title, body);
    return;
  }
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) sendNotification({ title, body });
    else toast.error(title, body);
  } catch {
    toast.error(title, body);
  }
}

/** Runs one monitor now (also used by "Run now"), records the result and notifies. */
export async function runMonitorNow(monitor: Monitor): Promise<void> {
  if (running.has(monitor.id)) return;
  running.add(monitor.id);
  try {
    const workspace = useWorkspaces.getState().workspaces.find((w) => w.monitors?.some((m) => m.id === monitor.id));
    if (!workspace) return;
    const outcome = await runMonitor(monitor, workspace);
    useRunHistory.getState().add(outcome.entry);
    useConsole.getState().log({
      kind: outcome.status === 'passed' ? 'script' : 'script-error',
      summary: `Monitor "${monitor.name}" · ${outcome.status} · ${outcome.summary}`,
      detail: '',
      tabName: monitor.name,
    });
    if (shouldNotify(monitor, outcome.status)) {
      const verb = outcome.status === 'passed' ? 'recovered' : outcome.status === 'failed' ? 'failed' : 'errored';
      await notify(`kapi monitor ${verb}: ${monitor.name}`, outcome.summary);
    }
    // Performance: the last 3 runs against the 10 before them, so one slow
    // sample never triggers anything; notify once on the way into a regression.
    const history = useRunHistory.getState().entries.filter((e) => e.monitorId === monitor.id);
    const perf = compareRecentToHistory(history);
    let perfPatch: Partial<Monitor> = {};
    if (perf) {
      const regressed = perf.changes.filter((c) => c.kind === 'regressed');
      const lastPerfSummary = regressed.length ? `${regressed[0].label}: ${regressed[0].reasons.join(', ')}${regressed.length > 1 ? ` (+${regressed.length - 1} more)` : ''}` : undefined;
      perfPatch = { lastPerf: regressed.length ? 'regressed' : 'ok', lastPerfSummary };
      if (regressed.length && monitor.lastPerf !== 'regressed' && monitor.notify !== 'never') {
        await notify(`kapi monitor got slower: ${monitor.name}`, lastPerfSummary!);
      }
    }
    useWorkspaces.getState().updateMonitor(monitor.id, { lastRunAt: Date.now(), lastStatus: outcome.status, lastSummary: outcome.summary, ...perfPatch });
  } finally {
    running.delete(monitor.id);
  }
}

/** Checks every workspace's monitors twice a minute while the app is open. Returns a stop function. */
export function startMonitorScheduler(): () => void {
  const tick = () => {
    for (const workspace of useWorkspaces.getState().workspaces) {
      for (const monitor of workspace.monitors ?? []) {
        if (isDue(monitor) && !running.has(monitor.id)) void runMonitorNow(monitor);
      }
    }
  };
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
