import vm from 'node:vm';
import { createKapiRuntime } from './runtime';
import { parseSandboxMessage, timeoutOutput, type ScriptSandbox, type SandboxOutput } from './sandbox';

/**
 * Runs scripts for the CLI, the MCP server and the test suite: a brand-new
 * `vm` context per script, holding nothing but the runtime itself.
 *
 * The runtime's *source* is evaluated inside the context (not passed in as a
 * host function), and the host never calls into the context except through
 * `runInContext` with a string argument — so nothing a script can reach was
 * created in the host's realm, which is what stops the classic
 * `x.constructor.constructor('return process')()` escape. Every entry into
 * the context carries a timeout, and `microtaskMode: 'afterEvaluate'` keeps
 * promise callbacks inside that budget too, so an infinite loop in a `.then`
 * can't hang a CI job.
 */
const RUNTIME_SOURCE = `(${createKapiRuntime.toString()})`;


export const nodeSandbox: ScriptSandbox = {
  async run(input, send, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const context = vm.createContext(Object.create(null), {
      name: 'kapi-script',
      codeGeneration: { strings: true, wasm: false },
      microtaskMode: 'afterEvaluate',
    });

    const remaining = () => Math.max(1, deadline - Date.now());
    const enter = (code: string, arg?: string): unknown => {
      (context as Record<string, unknown>).__kapiArg = arg;
      return vm.runInContext(code, context, { timeout: remaining(), displayErrors: false });
    };

    try {
      // `__name` is a no-op stand-in for the helper some transpilers (tsx/esbuild
      // with keepNames) insert into function bodies — the runtime's source
      // would otherwise reference a binding that only exists in the host.
      enter(
        `(() => {
          const stringify = JSON.stringify;
          const outbox = [];
          const runtime = (function () {
            const __name = (fn) => fn;
            return ${RUNTIME_SOURCE};
          })()((message) => { outbox.push(message); });
          Object.defineProperty(globalThis, '__kapi', {
            value: Object.freeze({
              start: (s) => { runtime.start(s); },
              deliver: (s) => { runtime.deliver(s); },
              drain: () => stringify(outbox.splice(0, outbox.length)),
            }),
            writable: false,
            configurable: false,
          });
        })()`,
      );
      enter('__kapi.start(__kapiArg)', JSON.stringify(input));

      for (;;) {
        if (Date.now() >= deadline) return timeoutOutput(input, timeoutMs);
        const drained = enter('__kapi.drain()');
        if (typeof drained !== 'string') throw new Error('script sandbox returned a non-string');
        const messages: unknown[] = JSON.parse(drained);
        let done: SandboxOutput | null = null;
        const sends: Promise<void>[] = [];
        for (const raw of messages) {
          const message = parseSandboxMessage(raw);
          if (!message) continue;
          if (message.type === 'done') {
            done = message.result;
            continue;
          }
          const { id, request } = message;
          sends.push(
            (send ? send(request) : Promise.reject(new Error('pm.sendRequest is not available here'))).then(
              (response) => void enter('__kapi.deliver(__kapiArg)', JSON.stringify({ id, response })),
              (err: unknown) => void enter('__kapi.deliver(__kapiArg)', JSON.stringify({ id, error: err instanceof Error ? err.message : String(err) })),
            ),
          );
        }
        if (done) return done;
        if (!sends.length) {
          // Nothing in flight and no result: the script is waiting on something
          // that will never arrive (e.g. an un-awaited promise that never settles).
          return { ...timeoutOutput(input, timeoutMs), error: 'Script finished waiting on something that never resolved' };
        }
        const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), remaining()));
        const raced = await Promise.race([Promise.all(sends).then(() => 'ok' as const), timer]);
        if (raced === 'timeout') return timeoutOutput(input, timeoutMs);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/timed out/i.test(message)) return timeoutOutput(input, timeoutMs);
      return { ...timeoutOutput(input, timeoutMs), error: message };
    }
  },
};
