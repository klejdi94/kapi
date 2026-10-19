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
import { EnvCompareModal } from '@/components/modals/EnvCompareModal';
import { useEnvCompare } from '@/store/envCompare';
import { ExportModal } from '@/components/modals/ExportModal';
import { CodeSnippetModal } from '@/components/modals/CodeSnippetModal';
import { PromptModal } from '@/components/modals/PromptModal';
import { CollectionDetailPage } from '@/components/collection/CollectionDetailPage';
import { FolderDetailPage } from '@/components/collection/FolderDetailPage';
import { WorkspaceOverview } from '@/components/workspace/WorkspaceOverview';
import { TokenInspectorModal } from '@/components/modals/TokenInspectorModal';
import { useTokenInspector } from '@/store/tokenInspector';
import { writeTabGrpc, writeTabRequest, writeTabWs } from '@/lib/tabWrite';
import { GrpcPanel } from '@/components/grpc/GrpcPanel';
import { upsertWorkspaceVariable } from '@/lib/varWrite';
import { RunnerPanel } from '@/components/runner/RunnerPanel';
import { useRunner } from '@/store/runner';
import { WsPanel } from '@/components/ws/WsPanel';
import { ConsolePanel } from '@/components/console/ConsolePanel';
import { useSession, useActiveTab } from '@/store/session';
import { useConsole } from '@/store/console';
import { onMockHit } from '@/lib/mock';
import { onDiscoveryCapture } from '@/lib/discovery';
import { useDiscovery } from '@/store/discovery';
import { formatBytes, formatDuration } from '@/lib/format';
import { toggleTheme } from '@/lib/theme';
import { isDesktop } from '@/lib/transport';
import { checkForUpdate, downloadAndInstallUpdate } from '@/lib/updater';
import { peekExternalChange, markExternalChangeApplied } from '@/lib/fileStorage';
import { pushToast } from '@/lib/toast';
import { listen } from '@tauri-apps/api/event';
import { useActiveWorkspace, useWorkspaces, findCollection } from '@/store/workspaces';
import { useHistory } from '@/store/history';
import { useResponses, useTabRun } from '@/store/responses';
import { buildScope } from '@/lib/variables';
import { resolveInheritedForNode } from '@/lib/inherit';
import { locate } from '@/lib/tree';
import { sendWithCookies } from '@/lib/sendWithCookies';
import { uid, newGrpcRequest, newWebSocketRequest } from '@/lib/factory';
import { toast } from '@/lib/toast';
import { responseToExample, exampleToResponse } from '@/lib/examples';
import { applyScriptRequest, chainScripts, responseToScriptInput, scriptRequestOf, type ScriptVars, type ChainOutcome, type TestResult } from '@/lib/scripting';
import { makeScriptSender } from '@/lib/scripting/sendBridge';
import { contractTestsLazy } from '@/lib/contractLazy';
import { startMonitorScheduler } from '@/lib/monitorScheduler';
import { useTestResults } from '@/store/testResults';
import { withTrailingBlank } from '@/lib/factory';
import type { GrpcRequestDef, KapiResponse, RequestDef, SavedExample, SentRequest, WebSocketRequestDef } from '@/types';
import { FileDown, X } from 'lucide-react';

const EMPTY_TESTS: TestResult[] = [];

/** Console entries carry whole bodies; this only guards against a pathological one. */
const CONSOLE_BODY_LIMIT = 250_000;

function clip(text: string): string {
  return text.length > CONSOLE_BODY_LIMIT
    ? `${text.slice(0, CONSOLE_BODY_LIMIT)}\n\n… ${text.length - CONSOLE_BODY_LIMIT} more characters not shown`
    : text;
}

const headerLines = (headers: [string, string][]) =>
  headers.length ? headers.map(([name, value]) => `${name}: ${value}`).join('\n') : '(no headers)';

/** The exact request that went on the wire — resolved variables, auth and all. */
function describeSent(sent: SentRequest): string {
  const body = sent.bodyText?.length
    ? `\n\n--- request body (${sent.bodyKind}) ---\n${clip(sent.bodyText)}`
    : sent.bodyKind === 'none'
      ? '\n\n(no request body)'
      : `\n\n(request body of type ${sent.bodyKind} is not textual)`;
  return `${sent.method} ${sent.url}\n\n--- request headers ---\n${headerLines(sent.headers)}${body}`;
}

/** Request and response side by side, so one console row is the whole exchange. */
function describeExchange(response: KapiResponse): string {
  const body = response.binary
    ? `(binary body, ${formatBytes(response.size.body)} — open the Preview tab to view it)`
    : response.text.length
      ? clip(response.text)
      : '(empty body)';
  return [
    describeSent(response.sent),
    '',
    `--- response ---`,
    `${response.status} ${response.statusText}${response.redirected ? `  (redirected → ${response.finalUrl})` : ''}`,
    `${formatDuration(response.timings.total)} total · ${formatDuration(response.timings.ttfb)} to first byte · ${formatBytes(response.size.body)}`,
    '',
    '--- response headers ---',
    headerLines(response.headers),
    '',
    '--- response body ---',
    body,
  ].join('\n');
}

export default function App() {
  const activeTab = useActiveTab();
  const activeTabId = useSession((s) => s.activeTabId);
  const patchTab = useSession((s) => s.patchTab);
  const openTab = useSession((s) => s.openTab);
  const openCollectionTab = useSession((s) => s.openCollectionTab);
  const closeTab = useSession((s) => s.closeTab);
  const closeOtherTabs = useSession((s) => s.closeOtherTabs);
  const closeAllTabs = useSession((s) => s.closeAllTabs);
  const sidebarOpen = useSession((s) => s.sidebarOpen);
  const sidebarWidth = useSession((s) => s.sidebarWidth);
  const splitLayout = useSession((s) => s.splitLayout);
  const splitRatio = useSession((s) => s.splitRatio);
  const setSession = useSession((s) => s.set);

  const workspace = useActiveWorkspace();
  const setGlobals = useWorkspaces((s) => s.setGlobals);
  const updateEnvironmentStore = useWorkspaces((s) => s.updateEnvironment);
  const updateCollectionStore = useWorkspaces((s) => s.updateCollection);
  const addCollection = useWorkspaces((s) => s.addCollection);
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
  const [exampleNameOpen, setExampleNameOpen] = useState(false);
  const [extractVariable, setExtractVariable] = useState<{ suggestedName: string; value: string } | null>(null);
  const consoleOpen = useConsole((s) => s.open);
  const testResults = useTestResults((s) => (activeTabId ? (s.byTab[activeTabId] ?? EMPTY_TESTS) : EMPTY_TESTS));

  const collection = activeTab ? findCollection(workspace, activeTab.collectionId) : null;
  const activeFolderLocated = activeTab?.kind === 'folder' && collection && activeTab.nodeId ? locate(collection.items, activeTab.nodeId) : null;
  const activeFolder = activeFolderLocated?.node.type === 'folder' ? activeFolderLocated.node : null;
  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);

  // The collection tree dispatches this rather than importing App state directly.
  useEffect(() => {
    const onExport = (e: Event) => setExportCollectionId((e as CustomEvent<string>).detail);
    window.addEventListener('kapi:export-collection', onExport);
    return () => {
      window.removeEventListener('kapi:export-collection', onExport);
    };
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

  // Captured while the Discovery panel isn't even the visible sidebar tab —
  // the capture window keeps reporting regardless, so this has to be global.
  useEffect(() => {
    const unlisten = onDiscoveryCapture((entries) => useDiscovery.getState().addBatch(entries));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId) ?? null;

  /** Writes a script phase's console output and errors into the Console panel. */
  const logScriptPhase = (phase: 'Pre-request' | 'Test', outcome: ChainOutcome, tabName: string) => {
    if (outcome.logs.length) {
      useConsole.getState().log({
        kind: 'script',
        summary: `${phase} script · ${outcome.logs.length} log${outcome.logs.length === 1 ? '' : 's'}`,
        detail: outcome.logs.join('\n'),
        tabName,
      });
    }
    for (const error of outcome.errors) {
      useConsole.getState().log({ kind: 'script-error', summary: `${phase} script failed — ${error}`, detail: error, tabName });
    }
  };

  /** Persists script variable writes back into the workspace, only when a script actually ran. */
  const persistScriptVars = (outcome: ChainOutcome) => {
    if (!outcome.ran) return;
    setGlobals(withTrailingBlank(outcome.vars.globals));
    if (environment) updateEnvironmentStore(environment.id, { variables: withTrailingBlank(outcome.vars.environment) });
    if (collection) updateCollectionStore(collection.id, { variables: withTrailingBlank(outcome.vars.collectionVariables) });
  };

  const doSend = async () => {
    if (!activeTab || activeTab.kind !== 'http') return;
    // The tab's own request may say `auth: 'inherit'` or rely on folder/collection
    // headers — resolve those before anything hits the wire.
    const resolved = resolveInheritedForNode(activeTab.request, collection, activeTab.nodeId);
    const startVars: ScriptVars = {
      environment: environment?.variables ?? [],
      globals: workspace.globals,
      collectionVariables: collection?.variables ?? [],
    };

    const scriptBase = {
      request: scriptRequestOf(resolved),
      environmentName: environment?.name,
      info: { requestName: activeTab.name, requestId: activeTab.nodeId ?? activeTab.id },
    };
    const scriptSender = makeScriptSender((r, s) => sendWithCookies(r, s), scope, resolved);
    const pre = await chainScripts([collection?.preRequestScript, activeTab.request.preRequestScript], startVars, scriptBase, 'prerequest', {
      sendRequest: scriptSender,
    });
    logScriptPhase('Pre-request', pre, activeTab.name);
    persistScriptVars(pre);
    // `pm.request.url = …` / `pm.request.headers.add(…)` apply to this send only;
    // the saved request is left as the user wrote it, same as Postman.
    const request = applyScriptRequest(resolved, pre);

    // Variables the pre-request script just set must be visible to {{...}}
    // substitution on this very send, so rebuild the scope from its output
    // rather than using the memo captured at render time.
    const sendScope = pre.ran
      ? buildScope(
          {
            ...workspace,
            globals: pre.vars.globals,
            environments: environment
              ? workspace.environments.map((e) => (e.id === environment.id ? { ...e, variables: pre.vars.environment } : e))
              : workspace.environments,
          },
          collection ? { ...collection, variables: pre.vars.collectionVariables } : null,
        )
      : scope;

    const controller = new AbortController();
    begin(activeTab.id, controller);
    useTestResults.getState().clear(activeTab.id);
    let sentForLog: SentRequest | null = null;
    const result = await sendWithCookies(request, sendScope, {
      signal: controller.signal,
      onPrepared: (sent) => {
        sentForLog = sent;
        useConsole.getState().log({
          kind: 'http-request',
          summary: `→ ${sent.method} ${sent.url}`,
          detail: describeSent(sent),
          tabName: activeTab.name,
        });
      },
      onSseEvent: (event) => useResponses.getState().appendSseEvent(activeTab.id, event),
    });
    finish(activeTab.id, result);
    if (result.ok) {
      const r = result.response;
      useConsole.getState().log({
        kind: 'http-response',
        summary: `← ${r.status} ${request.method} ${r.finalUrl} · ${formatDuration(r.timings.total)} · ${formatBytes(r.size.body)}`,
        detail: describeExchange(r),
        tabName: activeTab.name,
      });
      const post = await chainScripts(
        [collection?.testScript, activeTab.request.testScript],
        pre.vars,
        { ...scriptBase, request: pre.request, response: responseToScriptInput(result.response) },
        'test',
        { sendRequest: scriptSender },
      );
      // Checks against the OpenAPI spec the request came from, if any.
      post.tests.push(...(await contractTestsLazy(request.contract, result.response)));
      logScriptPhase('Test', post, activeTab.name);
      persistScriptVars(post);
      useTestResults.getState().setResults(activeTab.id, post.tests);
      if (post.tests.length) {
        const failed = post.tests.filter((t) => !t.passed).length;
        useConsole.getState().log({
          kind: failed ? 'script-error' : 'script',
          summary: `Tests · ${post.tests.length - failed}/${post.tests.length} passed`,
          detail: post.tests.map((t) => `${t.passed ? '✓' : '✕'} ${t.name}${t.error ? `\n    ${t.error}` : ''}`).join('\n'),
          tabName: activeTab.name,
        });
      }
    } else {
      useConsole.getState().log({
        kind: 'http-error',
        summary: `✕ ${request.method} ${request.url} — ${result.error.title}`,
        // Includes what was sent: a failed request is exactly when you need to
        // see the headers and body that produced the failure.
        detail: [
          `${result.error.title} (${result.error.kind}) after ${formatDuration(result.error.elapsed)}`,
          result.error.detail,
          ...(sentForLog ? ['', describeSent(sentForLog)] : []),
        ].join('\n'),
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
      request: structuredClone(resolved),
    });
  };

  // Autosave: a tab backed by a saved request writes straight back into its
  // collection on every change — no explicit Save step for anything that
  // already has a home. A brand-new tab (no nodeId yet) still needs Save As
  // to pick where it lives; onSave below covers that case.
  const onChangeRequest = (request: RequestDef) => {
    if (!activeTab) return;
    writeTabRequest(activeTab.id, request);
  };

  const onChangeWs = (ws: WebSocketRequestDef) => {
    if (!activeTab) return;
    writeTabWs(activeTab.id, ws);
  };

  const onChangeGrpc = (grpc: GrpcRequestDef) => {
    if (!activeTab) return;
    writeTabGrpc(activeTab.id, grpc);
  };

  const onSave = () => {
    if (!activeTab) return;
    if (activeTab.nodeId && activeTab.collectionId) {
      if (activeTab.kind === 'ws' && activeTab.ws) {
        writeTabWs(activeTab.id, activeTab.ws);
      } else if (activeTab.kind === 'grpc' && activeTab.grpc) {
        writeTabGrpc(activeTab.id, activeTab.grpc);
      } else {
        writeTabRequest(activeTab.id, activeTab.request);
      }
      toast.success('Saved');
    } else {
      setSaveAsTabId(activeTab.id);
    }
  };

  const onImportCurl = (request: RequestDef) => {
    if (!activeTab) return;
    writeTabRequest(activeTab.id, request);
    patchTab(activeTab.id, { name: 'Imported request' });
  };

  const persistExamples = (examples: SavedExample[]) => {
    if (!activeTab) return;
    writeTabRequest(activeTab.id, { ...activeTab.request, examples });
  };

  const onSaveExample = () => {
    if (!activeTab || activeTab.kind !== 'http' || !run.result?.ok) return;
    setExampleNameOpen(true);
  };

  const saveExampleAs = (name: string) => {
    if (!activeTab || activeTab.kind !== 'http' || !run.result?.ok) return;
    const example = responseToExample(run.result.response, name);
    const request = { ...activeTab.request, examples: [...(activeTab.request.examples ?? []), example] };
    writeTabRequest(activeTab.id, request);
    if (activeTab.nodeId && activeTab.collectionId) {
      toast.success('Saved example', `${name} · under "${activeTab.name}"`);
    } else {
      // Nothing to attach it to yet — the example lives in the tab until the
      // request itself is saved, so say so rather than implying it persisted.
      toast.info('Saved example', 'Save this request to a collection to keep it.');
    }
  };

  const onLoadExample = (example: SavedExample) => {
    if (!activeTab) return;
    const response = exampleToResponse(example, activeTab.request.method, activeTab.request.url);
    useResponses.getState().setResult(activeTab.id, { ok: true, response });
  };

  /** Claude-written assertions land in the request's own Tests script, appended to anything already there. */
  const onGeneratedTests = (script: string) => {
    if (!activeTab) return;
    const existing = activeTab.request.testScript?.trim();
    const testScript = existing ? `${existing}\n\n${script}\n` : `${script}\n`;
    writeTabRequest(activeTab.id, { ...activeTab.request, testScript });
    setSession('requestTab', 'scripts');
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
      case 'new-grpc-tab':
        openTab({ kind: 'grpc', name: 'New gRPC request', grpc: newGrpcRequest() });
        break;
      case 'close-tab':
        if (activeTabId) closeTab(activeTabId);
        break;
      case 'close-other-tabs':
        if (activeTabId) closeOtherTabs(activeTabId);
        break;
      case 'close-all-tabs':
        closeAllTabs();
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
      case 'check-for-updates':
        checkForUpdatesInteractive();
        break;
    }
  };

  // Shared by the menu item, the command palette, and the silent startup
  // check — `silent` suppresses the "you're up to date" toast so it only
  // shows for a user-initiated check.
  const checkForUpdatesInteractive = async (silent = false) => {
    try {
      const update = await checkForUpdate();
      if (!update) {
        if (!silent) toast.info("You're up to date", `kapi is on the latest version`);
        return;
      }
      pushToast({
        kind: 'info',
        title: `kapi ${update.version} is available`,
        detail: update.body,
        duration: 0,
        action: {
          label: 'Download & install',
          run: async () => {
            try {
              toast.info('Downloading update…');
              await downloadAndInstallUpdate();
            } catch (err) {
              toast.error('Update failed', err instanceof Error ? err.message : String(err));
            }
          },
        },
      });
    } catch (err) {
      if (!silent) toast.error('Could not check for updates', err instanceof Error ? err.message : String(err));
    }
  };

  // Scheduled collection runs (see lib/monitors.ts) while the app is open.
  useEffect(() => startMonitorScheduler(), []);

  // Quiet check shortly after launch — never interrupts the user, only
  // surfaces a toast when an update is actually found.
  useEffect(() => {
    if (!isDesktop()) return;
    const t = setTimeout(() => checkForUpdatesInteractive(true), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the workspace file from disk whenever the window regains focus,
  // if something outside this process changed it (the kapi-mcp server, or
  // another kapi window) — there's no file watcher, so without this the next
  // local edit here would silently overwrite that external write on its next
  // debounced flush. Skipped when a tab has unsaved edits, so an in-progress
  // draft is never thrown away without the user seeing it happen.
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const un = await getCurrentWindow().onFocusChanged(async ({ payload: focused }) => {
        if (!focused) return;
        const text = await peekExternalChange('kapi.workspaces');
        if (!text) return;
        const hasDirtyTab = useSession.getState().tabs.some((t) => t.dirty);
        if (hasDirtyTab) {
          toast.info('Workspace changed on disk', 'A tab has unsaved edits, so it was not reloaded automatically.');
          return;
        }
        await useWorkspaces.persist.rehydrate();
        markExternalChangeApplied('kapi.workspaces', text);
        toast.info('Workspace updated', 'Reloaded — it changed outside kapi (e.g. the kapi-mcp server).');
      });
      if (disposed) un();
      else unlisten = un;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
        runAction(e.shiftKey ? 'close-all-tabs' : 'close-tab');
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
    { id: 'new-grpc-tab', label: 'New gRPC tab', icon: <FileDown size={13} />, run: () => runAction('new-grpc-tab') },
    { id: 'close-tab', label: 'Close tab', icon: <X size={13} />, run: () => runAction('close-tab') },
    { id: 'close-other-tabs', label: 'Close other tabs', icon: <X size={13} />, run: () => runAction('close-other-tabs') },
    { id: 'close-all-tabs', label: 'Close all tabs', icon: <X size={13} />, run: () => runAction('close-all-tabs') },
    ...(activeTab?.kind === 'http' ? [{ id: 'generate-code', label: 'Generate code for this request…', icon: <FileDown size={13} />, run: () => setCodeOpen(true) }] : []),
    ...(activeTab?.kind === 'http' ? [{ id: 'compare-envs', label: 'Compare this request across environments…', icon: <FileDown size={13} />, run: () => useEnvCompare.getState().setOpen(true) }] : []),
    ...(collection
      ? [{ id: 'run-collection', label: `Run collection "${collection.name}"…`, icon: <FileDown size={13} />, run: () => useRunner.getState().openFor(collection.id, null) }]
      : []),
    { id: 'inspect-token', label: 'Inspect a token…', icon: <FileDown size={13} />, run: () => useTokenInspector.getState().openWith() },
    { id: 'check-for-updates', label: 'Check for updates…', icon: <FileDown size={13} />, run: () => checkForUpdatesInteractive() },
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
          {!activeTab && (
            <WorkspaceOverview
              workspace={workspace}
              actions={{
                onNewRequest: () => openTab(),
                onAskAi: () => {
                  setSession('sidebarPanel', 'ai');
                  setSession('sidebarOpen', true);
                },
                onImport: () => setImportOpen(true),
                onNewCollection: () => {
                  const id = addCollection();
                  openCollectionTab(id, 'New collection');
                },
                onDiscover: () => {
                  setSession('sidebarPanel', 'discovery');
                  setSession('sidebarOpen', true);
                },
              }}
            />
          )}
          {activeTab && activeTab.kind === 'ws' && activeTab.ws && (
            <WsPanel tabId={activeTab.id} request={activeTab.ws} onChange={onChangeWs} collection={collection} />
          )}
          {activeTab && activeTab.kind === 'grpc' && activeTab.grpc && (
            <GrpcPanel tabId={activeTab.id} request={activeTab.grpc} onChange={onChangeGrpc} collection={collection} />
          )}
          {activeTab && activeTab.kind === 'collection' && collection && (
            <CollectionDetailPage collection={collection} onExport={() => setExportCollectionId(collection.id)} />
          )}
          {activeTab && activeTab.kind === 'folder' && collection && activeFolder && <FolderDetailPage collection={collection} folder={activeFolder} />}
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
                    sseEvents={run.sseEvents}
                    onSaveExample={onSaveExample}
                    examples={activeTab.request.examples}
                    onLoadExample={onLoadExample}
                    onDeleteExample={onDeleteExample}
                    testResults={testResults}
                    hasTestScript={!!activeTab.request.testScript?.trim()}
                    onGeneratedTests={onGeneratedTests}
                    onExtractVariable={(suggestedName, value) => setExtractVariable({ suggestedName, value })}
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
      <TokenInspectorModal />
      <RunnerPanel />
      <PromptModal
        open={exampleNameOpen}
        title="Save response as example"
        label="Example name"
        defaultValue={run.result?.ok ? `${run.result.response.status} response` : 'Example'}
        onSubmit={saveExampleAs}
        onClose={() => setExampleNameOpen(false)}
      />
      <PromptModal
        open={extractVariable !== null}
        title="Save as variable"
        label="Variable name"
        defaultValue={extractVariable?.suggestedName ?? ''}
        confirmLabel="Save"
        onSubmit={(name) => {
          upsertWorkspaceVariable(name, extractVariable!.value);
          toast.success('Saved variable', `{{${name}}}`);
        }}
        onClose={() => setExtractVariable(null)}
      />
      <SaveAsModal open={saveAsTabId !== null} onClose={() => setSaveAsTabId(null)} tabId={saveAsTabId} />
      <EnvCompareModal
        key={activeTab?.id}
        request={activeTab?.kind === 'http' ? resolveInheritedForNode(activeTab.request, collection, activeTab.nodeId) : null}
        collection={collection}
      />
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
