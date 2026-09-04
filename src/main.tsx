import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { flushPendingWrites } from './lib/fileStorage';
import './styles/app.css';

// Debounced disk writes (see fileStorage.ts) must not be lost when the
// window closes before their timer fires.
window.addEventListener('beforeunload', flushPendingWrites);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
