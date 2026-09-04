import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { RequestDef, RequestTabKey, ResponseView, Tab } from '@/types';
import { newTab } from '@/lib/factory';
import { localJSONStorage } from '@/lib/storage';

export type SidebarPanel = 'collections' | 'environments' | 'history';
export type SplitLayout = 'horizontal' | 'vertical';

interface SessionState {
  tabs: Tab[];
  activeTabId: string;

  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarPanel: SidebarPanel;
  splitLayout: SplitLayout;
  /** Percentage of the workspace given to the request pane. */
  splitRatio: number;
  theme: 'dark' | 'light';
  requestTab: RequestTabKey;
  responseView: ResponseView;
  wrapLines: boolean;

  openTab: (tab?: Partial<Tab>) => string;
  openRequestNode: (args: { nodeId: string; collectionId: string; name: string; request: RequestDef }) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateTabRequest: (id: string, request: RequestDef) => void;
  patchTab: (id: string, patch: Partial<Tab>) => void;

  set: <K extends keyof SessionState>(key: K, value: SessionState[K]) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (setState, get) => ({
      tabs: [],
      activeTabId: '',

      sidebarOpen: true,
      sidebarWidth: 280,
      sidebarPanel: 'collections',
      splitLayout: 'horizontal',
      splitRatio: 48,
      theme: 'dark',
      requestTab: 'params',
      responseView: 'pretty',
      wrapLines: true,

      openTab: (partial) => {
        const tab = newTab(partial);
        setState((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
        return tab.id;
      },

      openRequestNode: ({ nodeId, collectionId, name, request }) => {
        // A saved request gets one tab, reused rather than duplicated.
        const existing = get().tabs.find((t) => t.nodeId === nodeId);
        if (existing) {
          setState({ activeTabId: existing.id });
          return existing.id;
        }
        const tab = newTab({ nodeId, collectionId, name, request: structuredClone(request) });
        setState((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }));
        return tab.id;
      },

      closeTab: (id) =>
        setState((state) => {
          const index = state.tabs.findIndex((t) => t.id === id);
          if (index === -1) return state;
          const tabs = state.tabs.filter((t) => t.id !== id);
          let activeTabId = state.activeTabId;
          if (activeTabId === id) activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? '';
          return { ...state, tabs, activeTabId };
        }),

      closeOtherTabs: (id) =>
        setState((state) => ({ ...state, tabs: state.tabs.filter((t) => t.id === id), activeTabId: id })),

      closeAllTabs: () => setState({ tabs: [], activeTabId: '' }),

      setActiveTab: (id) => setState({ activeTabId: id }),

      updateTabRequest: (id, request) =>
        setState((state) => ({
          tabs: state.tabs.map((t) => (t.id === id ? { ...t, request, dirty: t.nodeId ? true : t.dirty } : t)),
        })),

      patchTab: (id, patch) =>
        setState((state) => ({ tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      set: (key, value) => setState({ [key]: value } as Pick<SessionState, typeof key>),
    }),
    {
      name: 'kapi.session',
      version: 1,
      storage: createJSONStorage(() => localJSONStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        sidebarPanel: state.sidebarPanel,
        splitLayout: state.splitLayout,
        splitRatio: state.splitRatio,
        theme: state.theme,
        requestTab: state.requestTab,
        responseView: state.responseView,
        wrapLines: state.wrapLines,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.tabs.length) {
          const tab = newTab();
          state.tabs = [tab];
          state.activeTabId = tab.id;
        } else if (!state.tabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.tabs[0].id;
        }
      },
    },
  ),
);

export function useActiveTab(): Tab | null {
  return useSession((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0] ?? null);
}
