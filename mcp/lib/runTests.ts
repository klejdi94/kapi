import type { Environment, KV, RunHistoryEntry, RunHistoryResult } from '@/types';
import { headlessTargetsFor, runHeadless, type HeadlessResult } from '@/cli/headlessRunner';
import { uid } from '@/lib/factory';
import { updateStore, STORE_RUN_HISTORY } from './fileStore.ts';
import { findCollectionAndWorkspace, readWorkspaceState } from './workspaceOps.ts';
import { withSecrets } from './secrets.ts';
import { locate } from '@/lib/tree';

const MAX_RUN_HISTORY = 200;

export interface RunTestsInput {
  collectionId: string;
  /** A folder's id or name, or omitted to run the whole collection. */
  scope?: string;
  environmentName?: string;
  iterations?: number;
  delayMs?: number;
}

export interface RunTestsOutput {
  collectionName: string;
  scopeName: string | null;
  passed: number;
  failed: number;
  errored: number;
  durationMs: number;
  results: HeadlessResult[];
  /** Set when secret variables couldn't be read from the encrypted store, so requests that need them may fail. */
  warning?: string;
}

function toRunHistoryResult(r: HeadlessResult): RunHistoryResult {
  return {
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
  };
}

/**
 * Runs a battery of requests the same way `cli/kapi-run.ts` does for CI, and
 * additionally records a `RunHistoryEntry` (same shape the GUI's "Run
 * collection" writes in `RunnerPanel.tsx`) so the run shows up in kapi's own
 * History tab — an AI-driven run should look, in the app, exactly like one a
 * person triggered by hand.
 */
export async function runTests(input: RunTestsInput): Promise<RunTestsOutput | { error: string }> {
  // Secret values live in kapi's encrypted vault, not the workspace file.
  const { state, missing } = await withSecrets(await readWorkspaceState());
  const found = findCollectionAndWorkspace(state, input.collectionId);
  if (!found) return { error: `No collection with id "${input.collectionId}" was found.` };
  const { collection, workspace } = found;

  let scopeNodeId: string | null = null;
  let scopeName: string | null = null;
  if (input.scope) {
    const byId = locate(collection.items, input.scope);
    if (byId && byId.node.type === 'folder') {
      scopeNodeId = byId.node.id;
      scopeName = byId.node.name;
    } else {
      const byName = collection.items.find((n) => n.type === 'folder' && n.name.toLowerCase() === input.scope!.toLowerCase());
      if (byName) {
        scopeNodeId = byName.id;
        scopeName = byName.name;
      } else {
        return { error: `No folder named or with id "${input.scope}" was found in this collection.` };
      }
    }
  }

  const targets = headlessTargetsFor(collection, scopeNodeId);
  if (!targets.length) return { error: scopeName ? `Folder "${scopeName}" has no requests.` : 'This collection has no requests.' };

  let environment: Environment | null = null;
  if (input.environmentName) {
    environment = workspace.environments.find((e) => e.name.toLowerCase() === input.environmentName!.toLowerCase()) ?? null;
    if (!environment) return { error: `No environment named "${input.environmentName}" was found in this workspace.` };
  }

  const globals: KV[] = workspace.globals;
  const results: HeadlessResult[] = [];
  const started = Date.now();
  await runHeadless({
    collection,
    globals,
    environment,
    targets,
    iterations: input.iterations ?? 1,
    dataRows: [],
    delayMs: input.delayMs ?? 0,
    onResult: (r) => results.push(r),
  });
  const durationMs = Date.now() - started;

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const errored = results.filter((r) => r.status === 'error').length;

  const entry: RunHistoryEntry = {
    id: uid(),
    collectionId: collection.id,
    collectionName: collection.name,
    scopeName,
    at: Date.now(),
    iterations: input.iterations ?? 1,
    durationMs,
    passed,
    failed,
    errored,
    results: results.map(toRunHistoryResult),
  };
  await updateStore(STORE_RUN_HISTORY, { entries: [] as RunHistoryEntry[] }, (s) => ({
    entries: [entry, ...s.entries].slice(0, MAX_RUN_HISTORY),
  }));

  const warning = missing
    ? `${missing} secret variable${missing === 1 ? '' : 's'} couldn't be read from kapi's encrypted store (the OS keychain didn't hand over the key), so ${missing === 1 ? 'it was' : 'they were'} empty for this run.`
    : undefined;
  return { collectionName: collection.name, scopeName, passed, failed, errored, durationMs, results, ...(warning ? { warning } : {}) };
}
