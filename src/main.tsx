import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { flushPendingWrites } from './lib/fileStorage';
import './styles/app.css';

// Debounced disk writes (see fileStorage.ts) must not be lost when the
// window closes before their timer fires.
window.addEventListener('beforeunload', flushPendingWrites);

/**
 * The webview's own context menu is a browser affordance ("Inspect Element",
 * "Reload") that has no place in a desktop app — kapi ships its own menus
 * everywhere it needs one. Real text fields keep the native menu, since
 * cut/copy/paste there is genuinely useful.
 */
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea')) return;
  event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
