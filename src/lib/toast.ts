import { uid } from './factory';

export type ToastKind = 'info' | 'success' | 'error' | 'warn';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: ToastAction;
  /** 0 keeps it up until dismissed. */
  duration: number;
}

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = toasts;
  listeners.forEach((l) => l(snapshot));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function pushToast(input: Omit<Toast, 'id' | 'duration'> & { duration?: number }): string {
  const toast: Toast = {
    id: uid(),
    duration: input.duration ?? (input.kind === 'error' ? 7000 : 3500),
    ...input,
  };
  toasts = [...toasts, toast];
  emit();
  if (toast.duration > 0) setTimeout(() => dismissToast(toast.id), toast.duration);
  return toast.id;
}

export const toast = {
  info: (title: string, detail?: string) => pushToast({ kind: 'info', title, detail }),
  success: (title: string, detail?: string) => pushToast({ kind: 'success', title, detail }),
  warn: (title: string, detail?: string) => pushToast({ kind: 'warn', title, detail }),
  error: (title: string, detail?: string) => pushToast({ kind: 'error', title, detail }),
  undo: (title: string, run: () => void) =>
    pushToast({ kind: 'info', title, action: { label: 'Undo', run }, duration: 6000 }),
};
