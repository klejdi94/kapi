/// <reference lib="webworker" />
import { createKapiRuntime } from './runtime';
import { SANDBOX_LIB_SOURCES } from './sandboxLibs.generated.js';

/**
 * One worker per script run. A Web Worker gets none of the Tauri IPC bridge
 * the main window has, so code in here can't read or write files, run git, or
 * reach the native HTTP client — its only way out is the JSON messages below,
 * which the host validates (see workerSandbox.ts). The host terminates the
 * worker as soon as the run is done or the time budget is up.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const runtime = createKapiRuntime((message) => scope.postMessage(message), SANDBOX_LIB_SOURCES);

scope.onmessage = (event: MessageEvent<{ kind: 'start' | 'deliver'; payload: string }>) => {
  const { kind, payload } = event.data ?? ({} as { kind?: string; payload?: string });
  if (typeof payload !== 'string') return;
  if (kind === 'start') runtime.start(payload);
  else if (kind === 'deliver') runtime.deliver(payload);
};
