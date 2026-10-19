import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { flushPendingWrites } from './lib/fileStorage';
import { installExitFlush } from './lib/exitFlush';
import { setScriptSandbox } from './lib/scripting';
import { workerSandbox } from './lib/scripting/workerSandbox';
import { setSecretRefResolver } from './lib/secretRefs';
import { isDesktop } from './lib/transport';
import { invoke } from '@tauri-apps/api/core';
import './styles/app.css';

// Pre-request/test scripts run in a disposable Web Worker with no Tauri IPC —
// see lib/scripting/sandbox.ts for why they never run in this window.
setScriptSandbox(workerSandbox);

// op:// · awssm:// · vault:// references in environment/global variables are
// read through the manager's own CLI; the native side asks for consent per
// reference (see src-tauri/src/secret_refs.rs).
if (isDesktop()) {
  setSecretRefResolver((reference, purpose) => invoke<string>('kapi_resolve_secret_ref', { reference, purpose }));
}

// Debounced disk writes (see fileStorage.ts) must not be lost when the
// window closes or the app quits before their timer fires. `beforeunload`
// stays as a best-effort fallback for exits that bypass both (e.g. a reload).
void installExitFlush();
window.addEventListener('beforeunload', () => void flushPendingWrites());

/**
 * The webview's own context menu is a browser affordance ("Inspect Element",
 * "Reload") that has no place in a desktop app — kapi ships its own menus
 * everywhere it needs one. Real text fields keep the native menu, since
 * cut/copy/paste there is genuinely useful. Registered on the capture phase
 * (fires before any element's own listener, kapi's own included) so this
 * always gets first look at the event — on the bubble phase it ran after
 * everything else, which is one more chance for WKWebView's native menu to
 * win the race on some macOS/WebKit versions.
 */
window.addEventListener(
  'contextmenu',
  (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea')) return;
    event.preventDefault();
  },
  { capture: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
