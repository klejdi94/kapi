import type { Monitor, RunHistoryEntry, Workspace } from '@/types';
import { headlessTargetsFor, runHeadless, type HeadlessResult } from '@/cli/headlessRunner';
import { locate } from './tree';
import { uid } from './factory';
import { send } from './send';
import { memoryCookieJar, withCookieJar } from './cookieSend';

/**
 * Monitors: a collection (or folder) run on a schedule while kapi is open,
 * through the same pipeline as the Runner. A monitor reads the workspace as it
 * is at run time and never writes variables back — like a CI job, each run
 * starts from the saved state. Results go into run history; failures (or
 * status changes) raise a system notification.
 */

export function isDue(monitor: Monitor, now = Date.now()): boolean {
  if (!monitor.enabled) return false;
  if (!monitor.lastRunAt) return true;
  return now - monitor.lastRunAt >= Math.max(1, monitor.intervalMinutes) * 60_000;
}

export interface MonitorRunOutcome {
  entry: RunHistoryEntry;
  status: 'passed' | 'failed' | 'error';
  summary: string;
}

export async function runMonitor(monitor: Monitor, workspace: Workspace): Promise<MonitorRunOutcome> {
  const collection = workspace.collections.find((c) => c.id === monitor.collectionId);
  const started = Date.now();
  const base = { id: uid(), monitorId: monitor.id, collectionId: monitor.collectionId, iterations: 1, at: started };
  if (!collection) {
    const summary = 'The collection this monitor runs no longer exists';
    return { status: 'error', summary, entry: { ...base, collectionName: '(deleted)', scopeName: null, durationMs: 0, passed: 0, failed: 0, errored: 1, results: [] } };
  }
  const scoped = monitor.scopeNodeId ? locate(collection.items, monitor.scopeNodeId) : null;
  const scopeName = scoped?.node.type === 'folder' ? scoped.node.name : null;
  const environment = workspace.environments.find((e) => e.id === monitor.environmentId) ?? null;
  const results: HeadlessResult[] = [];
  await runHeadless({
    collection,
    globals: workspace.globals,
    environment,
    targets: headlessTargetsFor(collection, monitor.scopeNodeId),
    iterations: 1,
    dataRows: [],
    delayMs: 0,
    sendFn: withCookieJar(memoryCookieJar(), (request, scope) => send(request, scope, {})),
    onResult: (r) => results.push(r),
  });
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const status: MonitorRunOutcome['status'] = errored ? 'error' : failed ? 'failed' : 'passed';
  const firstProblem = results.find((r) => r.status !== 'passed');
  const summary =
    status === 'passed'
      ? `${passed}/${results.length} requests passed`
      : `${failed + errored} of ${results.length} failed — first: ${firstProblem?.name}${firstProblem?.errorMessage ? ` (${firstProblem.errorMessage.split('\n')[0]})` : firstProblem?.tests.find((t) => !t.passed)?.name ? ` (${firstProblem.tests.find((t) => !t.passed)!.name})` : ''}`;
  const entry: RunHistoryEntry = {
    ...base,
    collectionName: collection.name,
    scopeName,
    durationMs: Date.now() - started,
    passed,
    failed,
    errored,
    results: results.map((r) => ({
      iteration: r.iteration,
      name: r.name,
      path: r.path,
      method: r.method,
      url: r.url,
      status: r.status,
      httpStatus: r.httpStatus,
      durationMs: r.durationMs,
      errorMessage: r.errorMessage,
      testsPassed: r.tests.filter((t) => t.passed).length,
      testsTotal: r.tests.length,
    })),
  };
  return { entry, status, summary };
}

/** Whether a finished run deserves a notification, given the monitor's setting and its previous status. */
export function shouldNotify(monitor: Monitor, status: MonitorRunOutcome['status']): boolean {
  if (monitor.notify === 'never') return false;
  if (monitor.notify === 'failures') return status !== 'passed';
  return monitor.lastStatus !== undefined && monitor.lastStatus !== status;
}

/** A GitHub Actions workflow that runs the same check on a schedule when kapi isn't open. */
export function ciWorkflowFor(monitor: Monitor, collectionFile: string, environmentFile: string | null): string {
  // GitHub's minimum schedule is every 5 minutes.
  const minutes = Math.max(5, monitor.intervalMinutes);
  const cron = minutes < 60 ? `*/${minutes} * * * *` : minutes % 1440 === 0 ? '0 6 * * *' : `0 */${Math.min(23, Math.round(minutes / 60))} * * *`;
  const folder = monitor.scopeNodeId ? ` --folder "${monitor.scopeNodeId}"` : '';
  const env = environmentFile ? ` --env ${environmentFile}` : '';
  return [
    `name: ${monitor.name.replace(/[\n:]/g, ' ')}`,
    '',
    'on:',
    '  schedule:',
    `    - cron: '${cron}'`,
    '  workflow_dispatch: {}',
    '',
    'jobs:',
    '  monitor:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    `      - run: npx -y kapi run ${collectionFile}${env}${folder}`,
    '',
  ].join('\n');
}
