import type { Collection, Environment, KV, RequestNode, Workspace } from '@/types';
import { buildScope, type VarScope } from '@/lib/variables';
import { resolveInherited } from '@/lib/inherit';
import { ancestorsOf, locate, walk } from '@/lib/tree';
import { send } from '@/lib/send';
import { applyScriptRequest, chainScripts, responseToScriptInput, scriptRequestOf, type ScriptVars } from '@/lib/scripting';
import { makeScriptSender } from '@/lib/scripting/sendBridge';

export interface HeadlessTarget {
  node: RequestNode;
  path: string[];
}

export interface HeadlessResult {
  iteration: number;
  name: string;
  path: string[];
  method: string;
  url: string;
  status: 'passed' | 'failed' | 'error';
  httpStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  tests: { name: string; passed: boolean; error: string | null }[];
}

/** Same flattening `lib/runner.ts` uses for the GUI runner — every request under `scopeNodeId`, or the whole collection when it's null. */
export function headlessTargetsFor(collection: Collection, scopeNodeId: string | null): HeadlessTarget[] {
  const out: HeadlessTarget[] = [];
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
 * A CLI/CI-friendly twin of `lib/runner.ts`'s `runCollection` — same
 * pre-request → send → test pipeline, same variable-carries-forward
 * behaviour between requests and iterations, but threading `globals` /
 * `environment` / `collection.variables` through as plain local values
 * instead of a Zustand store, since there's no app instance running them
 * here. Doesn't touch a cookie jar or persist anything to disk; a `--env`
 * file's edits (e.g. a login setting a token) live only for this run.
 */
export async function runHeadless(opts: {
  collection: Collection;
  globals: KV[];
  environment: Environment | null;
  targets: HeadlessTarget[];
  iterations: number;
  dataRows: Record<string, string>[];
  delayMs: number;
  onResult: (result: HeadlessResult) => void;
}): Promise<void> {
  let globals = opts.globals;
  // A placeholder when no --env was given, purely so `pm.environment.set(...)`
  // (e.g. a login response handing a token to the requests after it) has
  // somewhere to land for the rest of this run — without one, a script's
  // write would have nothing to attach to and silently vanish.
  let environment: Environment = opts.environment ?? { id: 'headless', name: 'headless', variables: [] };
  let collectionVars = opts.collection.variables;
  const iterationCount = Math.max(1, opts.iterations);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let iteration = 0; iteration < iterationCount; iteration++) {
    const dataRow = opts.dataRows.length ? opts.dataRows[iteration % opts.dataRows.length] : null;

    for (const target of opts.targets) {
      const resolved = resolveInherited(target.node.request, opts.collection, ancestorsOf(opts.collection.items, target.node.id));
      const startVars: ScriptVars = { environment: environment.variables, globals, collectionVariables: collectionVars };
      const scopeFor = (): VarScope => {
        const workspaceLike: Workspace = {
          id: '', name: '', icon: '', collections: [], globals,
          environments: [environment],
          activeEnvironmentId: environment.id,
          createdAt: 0, updatedAt: 0, gitRepoPath: null,
          mockServer: { port: 0, routes: [] }, cookies: [],
        };
        const built = buildScope(workspaceLike, { ...opts.collection, variables: collectionVars });
        if (dataRow) for (const [key, value] of Object.entries(dataRow)) built.set(key, { value, source: 'dynamic', origin: 'Data file' });
        return built;
      };

      const info = { requestName: target.node.name, requestId: target.node.id, iteration, iterationCount };
      const scriptBase = { request: scriptRequestOf(resolved), environmentName: environment.name, iterationData: dataRow ?? undefined, info };
      const scriptSender = makeScriptSender((r, s) => send(r, s, {}), scopeFor(), resolved);
      const pre = await chainScripts([opts.collection.preRequestScript, resolved.preRequestScript], startVars, scriptBase, 'prerequest', {
        sendRequest: scriptSender,
      });
      if (pre.ran) {
        globals = pre.vars.globals;
        environment = { ...environment, variables: pre.vars.environment };
        collectionVars = pre.vars.collectionVariables;
      }
      const request = applyScriptRequest(resolved, pre);
      const scope = scopeFor();

      const started = performance.now();
      const result = await send(request, scope, {});
      const durationMs = performance.now() - started;
      const base = { iteration, name: target.node.name, path: target.path, method: request.method, url: request.url, durationMs };

      if (!result.ok) {
        opts.onResult({ ...base, status: 'error', httpStatus: null, errorMessage: result.error.title, tests: [] });
        if (opts.delayMs > 0) await sleep(opts.delayMs);
        continue;
      }

      const post = await chainScripts(
        [opts.collection.testScript, request.testScript],
        pre.vars,
        { ...scriptBase, request: pre.request, response: responseToScriptInput(result.response) },
        'test',
        { sendRequest: scriptSender },
      );
      if (post.ran) {
        globals = post.vars.globals;
        environment = { ...environment, variables: post.vars.environment };
        collectionVars = post.vars.collectionVariables;
      }

      const failed = post.tests.some((t) => !t.passed);
      opts.onResult({
        ...base,
        status: post.tests.length ? (failed ? 'failed' : 'passed') : 'passed',
        httpStatus: result.response.status,
        errorMessage: pre.errors.length || post.errors.length ? [...pre.errors, ...post.errors].join('\n') : null,
        tests: post.tests,
      });

      if (opts.delayMs > 0) await sleep(opts.delayMs);
    }
  }
}
