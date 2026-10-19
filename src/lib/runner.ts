import type { Collection, KapiResponse, RequestNode, Workspace } from '@/types';
import { buildScope } from './variables';
import { resolveInherited } from './inherit';
import { ancestorsOf, locate, walk } from './tree';
import { sendWithCookies } from './sendWithCookies';
import { applyScriptRequest, chainScripts, responseToScriptInput, scriptRequestOf, type ScriptVars, type TestResult } from './scripting';
import { makeScriptSender } from './scripting/sendBridge';
import { useWorkspaces, activeWorkspace, findCollection } from '@/store/workspaces';
import { useConsole } from '@/store/console';
import { withTrailingBlank } from './factory';

export type RunnerRowStatus = 'running' | 'passed' | 'failed' | 'error';

export interface RunnerResult {
  id: string;
  iteration: number;
  nodeId: string;
  name: string;
  path: string[];
  method: string;
  url: string;
  status: RunnerRowStatus;
  httpStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  tests: TestResult[];
  response: KapiResponse | null;
}

export interface RunnerTarget {
  node: RequestNode;
  path: string[];
}

export interface RunCollectionOptions {
  workspaceId: string;
  collectionId: string;
  targets: RunnerTarget[];
  iterations: number;
  dataRows: Record<string, string>[];
  delayMs: number;
  signal: AbortSignal;
  onResult: (result: RunnerResult) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Every request under `scopeNodeId` (a folder), or the whole collection when
 * it's null, in tree order, each carrying the folder names it sits under.
 */
export function targetsFor(collection: Collection, scopeNodeId: string | null): RunnerTarget[] {
  const out: RunnerTarget[] = [];
  const collect = (items: Collection['items']) => {
    walk(items, (node, ancestors) => {
      if (node.type === 'request') out.push({ node, path: ancestors.map((f) => f.name) });
    });
  };

  if (!scopeNodeId) {
    collect(collection.items);
    return out;
  }
  const located = locate(collection.items, scopeNodeId);
  if (!located) return out;
  if (located.node.type === 'request') return [{ node: located.node, path: [] }];
  if (located.node.type === 'folder') collect(located.node.items);
  return out;
}

/**
 * Persists script variable writes back into the workspace store, exactly the
 * way a single manual send does (`App.tsx`'s `persistScriptVars`) — so a
 * login request earlier in the run can hand a token to requests later in the
 * same iteration, and later iterations see it too.
 */
function persistVars(workspace: Workspace, collection: Collection, vars: ScriptVars, ran: boolean) {
  if (!ran) return;
  const { setGlobals, updateEnvironment, updateCollection } = useWorkspaces.getState();
  setGlobals(withTrailingBlank(vars.globals));
  const env = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
  if (env) updateEnvironment(env.id, { variables: withTrailingBlank(vars.environment) });
  updateCollection(collection.id, { variables: withTrailingBlank(vars.collectionVariables) });
}

/**
 * Runs a flattened list of requests, in order, for N iterations — the same
 * pre-request → send → test pipeline `App.tsx` uses for a single manual send,
 * looped and fed one row of a data file per iteration when one is supplied.
 * Reports each request's outcome via `onResult` as it completes, so the UI
 * can render a live list rather than waiting for the whole run.
 */
export async function runCollection(opts: RunCollectionOptions): Promise<void> {
  const { targets, iterations, dataRows, delayMs, signal, onResult } = opts;
  const iterationCount = Math.max(1, iterations);

  for (let iteration = 0; iteration < iterationCount; iteration++) {
    if (signal.aborted) return;
    const dataRow = dataRows.length ? dataRows[iteration % dataRows.length] : null;

    for (const target of targets) {
      if (signal.aborted) return;

      // Re-read fresh each request: earlier requests in this same loop may
      // have just written variables other requests depend on.
      const workspace = activeWorkspace(useWorkspaces.getState());
      const collection = findCollection(workspace, opts.collectionId);
      if (!collection) return;

      const resolved = resolveInherited(target.node.request, collection, ancestorsOf(collection.items, target.node.id));
      const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId) ?? null;
      const startVars: ScriptVars = {
        environment: environment?.variables ?? [],
        globals: workspace.globals,
        collectionVariables: collection.variables,
      };

      const info = { requestName: target.node.name, requestId: target.node.id, iteration, iterationCount };
      const scriptBase = { request: scriptRequestOf(resolved), environmentName: environment?.name, iterationData: dataRow ?? undefined, info };
      const scriptSender = makeScriptSender((r, s) => sendWithCookies(r, s, { signal }), buildScope(workspace, collection), resolved);
      const pre = await chainScripts([collection.preRequestScript, resolved.preRequestScript], startVars, scriptBase, 'prerequest', {
        sendRequest: scriptSender,
      });
      persistVars(workspace, collection, pre.vars, pre.ran);
      const request = applyScriptRequest(resolved, pre);

      let scope = buildScope(
        pre.ran
          ? {
              ...workspace,
              globals: pre.vars.globals,
              environments: environment
                ? workspace.environments.map((e) => (e.id === environment.id ? { ...e, variables: pre.vars.environment } : e))
                : workspace.environments,
            }
          : workspace,
        pre.ran ? { ...collection, variables: pre.vars.collectionVariables } : collection,
      );
      if (dataRow) {
        for (const [key, value] of Object.entries(dataRow)) scope.set(key, { value, source: 'dynamic', origin: 'Data file' });
      }

      const started = performance.now();
      const result = await sendWithCookies(request, scope, { signal });
      const durationMs = performance.now() - started;

      const base = {
        id: `${iteration}-${target.node.id}-${Math.random().toString(36).slice(2, 8)}`,
        iteration,
        nodeId: target.node.id,
        name: target.node.name,
        path: target.path,
        method: request.method,
        url: request.url,
        durationMs,
      };

      if (!result.ok) {
        useConsole.getState().log({
          kind: 'http-error',
          summary: `✕ Runner · ${request.method} ${request.url} — ${result.error.title}`,
          detail: `${result.error.title} (${result.error.kind})\n${result.error.detail}`,
          tabName: target.node.name,
        });
        onResult({ ...base, status: 'error', httpStatus: null, errorMessage: result.error.title, tests: [], response: null });
        continue;
      }

      const post = await chainScripts(
        [collection.testScript, request.testScript],
        pre.vars,
        { ...scriptBase, request: pre.request, response: responseToScriptInput(result.response) },
        'test',
        { sendRequest: scriptSender },
      );
      persistVars(workspace, collection, post.vars, post.ran);

      const failed = post.tests.some((t) => !t.passed);
      useConsole.getState().log({
        kind: 'http-response',
        summary: `Runner · ${result.response.status} ${request.method} ${request.url}${post.tests.length ? ` · ${post.tests.length - post.tests.filter((t) => !t.passed).length}/${post.tests.length} tests passed` : ''}`,
        detail: [...pre.errors, ...post.errors, ...pre.logs, ...post.logs].join('\n'),
        tabName: target.node.name,
      });

      onResult({
        ...base,
        status: post.tests.length ? (failed ? 'failed' : 'passed') : 'passed',
        httpStatus: result.response.status,
        errorMessage: pre.errors.length || post.errors.length ? [...pre.errors, ...post.errors].join('\n') : null,
        tests: post.tests,
        response: result.response,
      });

      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
