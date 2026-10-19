import { parseSandboxMessage, timeoutOutput, type ScriptSandbox, type SandboxOutput } from './sandbox';

/** The desktop app's sandbox: a fresh, disposable Web Worker per script (see scriptWorker.ts). */
export const workerSandbox: ScriptSandbox = {
  run(input, send, timeoutMs) {
    return new Promise<SandboxOutput>((resolve) => {
      const worker = new Worker(new URL('./scriptWorker.ts', import.meta.url), { type: 'module', name: 'kapi-script' });
      let settled = false;
      const done = (output: SandboxOutput) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(output);
      };
      const timer = setTimeout(() => done(timeoutOutput(input, timeoutMs)), timeoutMs);

      worker.onmessage = (event: MessageEvent<unknown>) => {
        const message = parseSandboxMessage(event.data);
        if (!message) return;
        if (message.type === 'done') {
          done(message.result);
          return;
        }
        const { id, request } = message;
        const deliver = (payload: object) => {
          if (!settled) worker.postMessage({ kind: 'deliver', payload: JSON.stringify({ id, ...payload }) });
        };
        (send ? send(request) : Promise.reject(new Error('pm.sendRequest is not available here'))).then(
          (response) => deliver({ response }),
          (err: unknown) => deliver({ error: err instanceof Error ? err.message : String(err) }),
        );
      };
      worker.onerror = (event) => {
        event.preventDefault();
        done({ ...timeoutOutput(input, timeoutMs), error: event.message || 'Script worker failed to start' });
      };
      worker.postMessage({ kind: 'start', payload: JSON.stringify(input) });
    });
  },
};
