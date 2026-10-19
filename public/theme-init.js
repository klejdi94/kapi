// Applied before paint so the app never flashes the wrong theme. A separate
// file rather than an inline <script> so the CSP can stay `script-src 'self'`.
try {
  var t = localStorage.getItem('kapi.theme');
  var dark = t ? t === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
