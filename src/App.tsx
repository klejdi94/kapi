import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { IconRail } from '@/components/layout/IconRail';
import { TabBar } from '@/components/layout/TabBar';
import { EnvironmentPicker } from '@/components/layout/EnvironmentPicker';
import { SplitPane, PixelSplitter } from '@/components/layout/Splitter';
import { StatusBar } from '@/components/layout/StatusBar';
import { CommandPalette, type Command } from '@/components/layout/CommandPalette';
import { RequestEditor } from '@/components/request/RequestEditor';
import { LoadingBar } from '@/components/request/UrlBar';
import { ResponseViewer } from '@/components/response/ResponseViewer';
import { ToastHost } from '@/components/ui/ToastHost';
import { ImportModal } from '@/components/modals/ImportModal';
import { SaveAsModal } from '@/components/modals/SaveAsModal';
import { ExportModal } from '@/components/modals/ExportModal';
import { CodeSnippetModal } from '@/components/modals/CodeSnippetModal';
import { WsPanel } from '@/components/ws/WsPanel';
import { ConsolePanel } from '@/components/console/ConsolePanel';
import { useSession, useActiveTab } from '@/store/session';
import { useConsole } from '@/store/console';
import { onMockHit } from '@/lib/mock';
import { formatDuration } from '@/lib/format';
import { toggleTheme } from '@/lib/theme';
import { isDesktop } from '@/lib/transport';
import { listen } from '@tauri-apps/api/event';
import { useActiveWorkspace, useWorkspaces, findCollection } from '@/store/workspaces';
import { useHistory } from '@/store/history';
import { useResponses, useTabRun } from '@/store/responses';
import { buildScope } from '@/lib/variables';
import { resolveInheritedForNode } from '@/lib/inherit';
import { send } from '@/lib/send';
import { uid, newWebSocketRequest } from '@/lib/factory';
import { toast } from '@/lib/toast';
import { responseToExample, exampleToResponse } from '@/lib/examples';
import type { RequestDef, SavedExample, WebSocketRequestDef } from '@/types';
import { FileDown } from 'lucide-react';

export default function App() {
  const tabs = useSession((s) => s.tabs);
  const activeTab = useActiveTab();
  const activeTabId = useSession((s) => s.activeTabId);
  const updateTabRequest = useSession((s) => s.updateTabRequest);
  const patchTab = useSession((s) => s.patchTab);
  const openTab = useSession((s) => s.openTab);
  const closeTab = useSession((s) => s.closeTab);
  const sidebarOpen = useSession((s) => s.sidebarOpen);
  const sidebarWidth = useSession((s) => s.sidebarWidth);
  const splitLayout = useSession((s) => s.splitLayout);
  const splitRatio = useSession((s) => s.splitRatio);
  const setSession = useSession((s) => s.set);

  const workspace = useActiveWorkspace();
  const updateRequest = useWorkspaces((s) => s.updateRequest);
  const updateWebSocketRequest = useWorkspaces((s) => s.updateWebSocketRequest);
  const updateTabWs = useSession((s) => s.updateTabWs);
  const addHistory = useHistory((s) => s.add);

  const begin = useResponses((s) => s.begin);
  const finish = useResponses((s) => s.finish);
  const cancelRun = useResponses((s) => s.cancel);
  const run = useTabRun(activeTabId);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [saveAsTabId, setSaveAsTabId] = useState<string | null>(null);
  const [exportCollectionId, setExportCollectionId] = useState<string | null | 'workspace'>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const consoleOpen = useConsole((s) => s.open);

  const collection = activeTab ? findCollection(workspace, activeTab.collectionId) : null;
  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);

  // First-run/no-tabs safety net: the session store always seeds one, but a
  // hard localStorage wipe mid-session could leave this empty.
  useEffect(() => {
    if (!tabs.length) openTab();
  }, [tabs.length, openTab]);

  // The collection tree dispatches this rather than importing App state directly.
  useEffect(() => {
    const onExport = (e: Event) => setExportCollectionId((e as CustomEvent<string>).detail);
    window.addEventListener('kapi:export-collection', onExport);
    return () => window.removeEventListener('kapi:export-collection', onExport);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', useSession.getState().theme === 'dark');
  }, []);

  // Mock server hits are logged regardless of whether the Mock panel is open.
  useEffect(() => {
    const unlisten = onMockHit((hit) => {
      useConsole.getState().log({
        kind: 'mock-hit',
        summary: `${hit.method} ${hit.path} → ${hit.status}${hit.matched ? '' : ' (no route matched)'}`,
        detail: `${hit.method} ${hit.path}\nStatus: ${hit.status}\nMatched a route: ${hit.matched ? 'yes' : 'no'}`,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const doSend = async () => {
    if (!activeTab || activeTab.kind !== 'http') return;
    // The tab's own request may say `auth: 'inherit'` or rely on folder/collection
    // headers — resolve those before anything hits the wire.
    const request = resolveInheritedForNode(activeTab.request, collection, activeTab.nodeId);
    const controller = new AbortController();
    begin(activeTab.id, controller);
    useConsole.getState().log({
      kind: 'http-request',
      summary: `→ ${request.method} ${request.url}`,
      detail: `${request.method} ${request.url}\n\n${request.headers.filter((h) => h.enabled && h.key).map((h) => `${h.key}: ${h.value}`).join('\n')}`,
      tabName: activeTab.name,
    });
    const result = await send(request, scope, { signal: controller.signal });
    finish(activeTab.id, result);
    if (result.ok) {
      const r = result.response;
      useConsole.getState().log({
        kind: 'http-response',
        summary: `← ${r.status} ${request.method} ${request.url} · ${formatDuration(r.timings.total)}`,
        detail: `${r.status} ${r.statusText}\n\n${r.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${r.binary ? '<binary body>' : r.text.slice(0, 5000)}`,
        tabName: activeTab.name,
      });
    } else {
      useConsole.getState().log({
        kind: 'http-error',
        summary: `✕ ${request.method} ${request.url} — ${result.error.title}`,
        detail: result.error.detail,
        tabName: activeTab.name,
      });
    }
    addHistory({
      id: uid(),
      name: activeTab.name,
      method: request.method,
      url: request.url,
      status: result.ok ? result.response.status : null,
      errorKind: result.ok ? null : result.error.kind,
      duration: result.ok ? result.response.timings.total : result.error.elapsed,
      size: result.ok ? result.response.size.body : 0,
      at: Date.now(),
      request: structuredClone(request),
    });
  };

  const onChangeRequest = (request: RequestDef) => {
    if (!activeTab) return;
    updateTabRequest(activeTab.id, request);
  };

  const onChangeWs = (ws: WebSocketRequestDef) => {
    if (!activeTab) return;
    updateTabWs(activeTab.id, ws);
  };

  const onSave = () => {
    if (!activeTab) return;
    if (activeTab.nodeId && activeTab.collectionId) {
      if (activeTab.kind === 'ws' && activeTab.ws) {
        updateWebSocketRequest(activeTab.collectionId, activeTab.nodeId, activeTab.ws);
      } else {
        updateRequest(activeTab.collectionId, activeTab.nodeId, activeTab.request);
      }
      patchTab(activeTab.id, { dirty: false });
      toast.success('Saved');
    } else {
      setSaveAsTabId(activeTab.id);
    }
  };

  const onImportCurl = (request: RequestDef) => {
    if (!activeTab) return;
    updateTabRequest(activeTab.id, request);
    patchTab(activeTab.id, { name: 'Imported request' });
  };

  const persistExamples = (examples: SavedExample[]) => {
    if (!activeTab) return;
    const request = { ...activeTab.request, examples };
    updateTabRequest(activeTab.id, request);
    if (activeTab.nodeId && activeTab.collectionId) updateRequest(activeTab.collectionId, activeTab.nodeId, request);
  };

  const onSaveExample = () => {
    if (!activeTab || activeTab.kind !== 'http' || !run.result?.ok) return;
    const name = prompt('Name this example', `${run.result.response.status} response`);
    if (!name) return;
    const example = responseToExample(run.result.response, name);
    persistExamples([...(activeTab.request.examples ?? []), example]);
    toast.success('Saved example', name);
  };

  const onLoadExample = (example: SavedExample) => {
    if (!activeTab) return;
    const response = exampleToResponse(example, activeTab.request.method, activeTab.request.url);
    useResponses.getState().setResult(activeTab.id, { ok: true, response });
  };

  const onDeleteExample = (id: string) => {
    if (!activeTab) return;
    persistExamples((activeTab.request.examples ?? []).filter((e) => e.id !== id));
  };

  // Shared by keyboard shortcuts and the native File/Edit/View menu — one
  // dispatcher so the menu never drifts out of sync with what ⌘-keys do.
  const runAction = (action: string) => {
    switch (action) {
      case 'command-palette':
        setPaletteOpen((o) => !o);
        break;
      case 'new-tab':
        openTab();
        break;
      case 'new-ws-tab':
        openTab({ kind: 'ws', name: 'New WebSocket', ws: newWebSocketRequest() });
        break;
      case 'close-tab':
        if (activeTabId) closeTab(activeTabId);
        break;
      case 'send':
        if (activeTab?.kind === 'http') doSend();
        break;
      case 'save':
        onSave();
        break;
      case 'toggle-sidebar':
        setSession('sidebarOpen', !sidebarOpen);
        break;
      case 'toggle-console':
        useConsole.getState().setOpen(!useConsole.getState().open);
        break;
      case 'toggle-theme':
        toggleTheme();
        break;
      case 'import':
        setImportOpen(true);
        break;
      case 'export-workspace':
        setExportCollectionId('workspace');
        break;
      case 'view-source':
        window.open('https://github.com/klejdi94/kapi', '_blank');
        break;
    }
  };

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        runAction('command-palette');
      } else if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        runAction('new-tab');
      } else if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        runAction('close-tab');
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        runAction('send');
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        runAction('save');
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        runAction('toggle-sidebar');
      } else if (mod && e.key === '`') {
        e.preventDefault();
        runAction('toggle-console');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, sidebarOpen, activeTab]);

  // The native File/Edit/View/Help menu (macOS menu bar) — every item just
  // emits its id here, dispatched through the same runAction as shortcuts.
  useEffect(() => {
    if (!isDesktop()) return;
    const unlisten = listen<string>('kapi://menu', (event) => runAction(event.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, sidebarOpen, activeTab]);

  const extraCommands: Command[] = [
    { id: 'import', label: 'Import…', icon: <FileDown size={13} />, run: () => setImportOpen(true) },
    { id: 'export-workspace', label: 'Export workspace…', icon: <FileDown size={13} />, run: () => setExportCollectionId('workspace') },
    { id: 'new-ws-tab', label: 'New WebSocket tab', icon: <FileDown size={13} />, run: () => openTab({ kind: 'ws', name: 'New WebSocket', ws: newWebSocketRequest() }) },
    ...(activeTab?.kind === 'http' ? [{ id: 'generate-code', label: 'Generate code for this request…', icon: <FileDown size={13} />, run: () => setCodeOpen(true) }] : []),
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-fg">
      <div className="flex min-h-0 flex-1">
        <IconRail />
        {sidebarOpen && (
          <>
            <div className="shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
              <Sidebar onOpenImport={() => setImportOpen(true)} onOpenExport={() => setExportCollectionId('workspace')} />
            </div>
            <PixelSplitter onResize={(px) => setSession('sidebarWidth', px)} />
          </>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar />
          {activeTab && activeTab.kind === 'ws' && activeTab.ws && (
            <WsPanel tabId={activeTab.id} request={activeTab.ws} onChange={onChangeWs} collection={collection} />
          )}
          {activeTab && activeTab.kind === 'http' && (
            <>
              <EnvironmentPicker collection={collection} />
              <LoadingBar active={run.loading} />
              <SplitPane
                direction={splitLayout}
                ratio={splitRatio}
                onRatio={(v) => setSession('splitRatio', v)}
                first={
                  <RequestEditor
                    tabId={activeTab.id}
                    nodeId={activeTab.nodeId}
                    request={activeTab.request}
                    onChange={onChangeRequest}
                    onSend={() => doSend()}
                    onCancel={() => cancelRun(activeTab.id)}
                    onSave={onSave}
                    onImportCurl={onImportCurl}
                    onGenerateCode={() => setCodeOpen(true)}
                    loading={run.loading}
                    dirty={activeTab.dirty || !activeTab.nodeId}
                    collection={collection}
                  />
                }
                second={
                  <ResponseViewer
                    run={run.result}
                    loading={run.loading}
                    onSaveExample={onSaveExample}
                    examples={activeTab.request.examples}
                    onLoadExample={onLoadExample}
                    onDeleteExample={onDeleteExample}
                  />
                }
              />
            </>
          )}
        </div>
      </div>

      {consoleOpen && <ConsolePanel />}
      <StatusBar />
      <ToastHost />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} extraCommands={extraCommands} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <SaveAsModal open={saveAsTabId !== null} onClose={() => setSaveAsTabId(null)} tabId={saveAsTabId} />
      <ExportModal
        open={exportCollectionId !== null}
        onClose={() => setExportCollectionId(null)}
        collectionId={exportCollectionId === 'workspace' ? null : exportCollectionId}
      />
      {activeTab && activeTab.kind === 'http' && (
        <CodeSnippetModal
          open={codeOpen}
          onClose={() => setCodeOpen(false)}
          request={activeTab.request}
          collectionId={activeTab.collectionId}
          nodeId={activeTab.nodeId}
        />
      )}
    </div>
  );
}
