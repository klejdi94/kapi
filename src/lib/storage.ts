import type { StateStorage } from 'zustand/middleware';
import { toast } from './toast';

/**
 * localStorage with two behaviours the default wrapper lacks: it survives
 * environments where storage throws outright (private windows, blocked cookies),
 * and it tells the user when a write is rejected for quota instead of silently
 * dropping their data.
 */
let quotaWarned = false;

export const localJSONStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      quotaWarned = false;
    } catch (err) {
      const e = err as { name?: string };
      const isQuota = e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
      if (isQuota && !quotaWarned) {
        quotaWarned = true;
        toast.error(
          'Browser storage is full',
          'Recent changes were not saved. Clear history from the sidebar, or export and remove a workspace.',
        );
      }
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* nothing sensible to do */
    }
  },
};

export function estimateStorageBytes(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('kapi.')) continue;
      total += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return total * 2; // UTF-16 code units
  } catch {
    return 0;
  }
}
