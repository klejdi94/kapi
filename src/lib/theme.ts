import { useSession } from '@/store/session';

export function toggleTheme() {
  const current = useSession.getState().theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.classList.toggle('dark', next === 'dark');
  useSession.getState().set('theme', next);
  try {
    localStorage.setItem('kapi.theme', next);
  } catch {
    /* ignore — this key only affects the pre-paint flash guard in index.html */
  }
}
