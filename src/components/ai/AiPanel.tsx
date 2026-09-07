import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Bot, Braces, Check, Copy, CornerDownLeft, FileText, Plus, Sparkles, Terminal, Trash2 } from 'lucide-react';
import { Button, Checkbox, EmptyState } from '@/components/ui/primitives';
import { Thinking } from '@/components/ui/Thinking';
import { useAiChat } from '@/store/aiChat';
import { askClaude, claudeAvailable, isClaudeCliInstalled } from '@/lib/claudeCli';
import { extractAiRequest, extractScriptBlock, stripAiRequestBlock } from '@/lib/aiRequestParse';
import { describeAiContext, type AiContextInput } from '@/lib/aiContext';
import { useSession, useActiveTab } from '@/store/session';
import { useActiveWorkspace, useWorkspaces, findCollection } from '@/store/workspaces';
import { useTabRun } from '@/store/responses';
import { resolveInheritedForNode } from '@/lib/inherit';
import { writeTabRequest } from '@/lib/tabWrite';
import { newRequestNode } from '@/lib/factory';
import { methodVar } from '@/lib/methodColor';
import { toast } from '@/lib/toast';
import type { RequestDef } from '@/types';

const STARTERS = [
  'A GET to the GitHub API for a user’s public repos',
  'POST a new order with a JSON body and bearer auth',
  'A paginated search endpoint with query params',
];

export function AiPanel() {
  const messages = useAiChat((s) => s.messages);
  const loading = useAiChat((s) => s.loading);
  const addMessage = useAiChat((s) => s.addMessage);
  const setLoading = useAiChat((s) => s.setLoading);
  const clear = useAiChat((s) => s.clear);
  const openTab = useSession((s) => s.openTab);
  const setSession = useSession((s) => s.set);
  const activeTab = useActiveTab();
  const workspace = useActiveWorkspace();
  const activeCollectionId = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.collections[0]?.id ?? null);
  const addNode = useWorkspaces((s) => s.addNode);
  const run = useTabRun(activeTab?.id ?? '');

  const [draft, setDraft] = useState('');
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [attachContext, setAttachContext] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isClaudeCliInstalled().then(setInstalled);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, loading]);

  if (!claudeAvailable()) {
    return (
      <EmptyState
        icon={<Bot size={22} />}
        title="The AI tab needs the desktop app"
        detail="Shelling out to the claude CLI isn't possible from a plain browser tab."
      />
    );
  }

  if (installed === false) {
    return (
      <EmptyState
        icon={<Terminal size={22} />}
        title="claude CLI not found"
        detail="This tab asks your own claude CLI to help draft requests — install Claude Code (npm install -g @anthropic-ai/claude-code, or see claude.com/code) and sign in, then reopen this tab."
      />
    );
  }

  const canAttach = !!activeTab && activeTab.kind === 'http';
  const collection = activeTab ? findCollection(workspace, activeTab.collectionId) : null;

  const buildContext = (): string | undefined => {
    if (!attachContext || !activeTab || activeTab.kind !== 'http') return undefined;
    const input: AiContextInput = { request: resolveInheritedForNode(activeTab.request, collection, activeTab.nodeId) };
    if (run.result?.ok) {
      const r = run.result.response;
      input.response = { status: r.status, statusText: r.statusText, headers: r.headers, text: r.text, binary: r.binary, timeMs: r.timings.total, sent: r.sent };
    } else if (run.result && !run.result.ok) {
      input.error = { error: run.result.error };
    }
    const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);
    const secrets = [...workspace.globals, ...(collection?.variables ?? []), ...(environment?.variables ?? [])]
      .filter((row) => row.secret && row.value)
      .map((row) => row.value);
    return describeAiContext(input, secrets);
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setDraft('');
    const history = [...messages, { role: 'user' as const, text: trimmed }];
    addMessage({ role: 'user', text: trimmed });
    setLoading(true);
    try {
      const reply = await askClaude(history, buildContext());
      addMessage({ role: 'assistant', text: reply });
    } catch (err) {
      toast.error('claude CLI failed', (err as Error).message);
      addMessage({ role: 'assistant', text: `_Error: ${(err as Error).message}_` });
    } finally {
      setLoading(false);
    }
  };

  const useRequest = (request: RequestDef) => {
    if (activeCollectionId) {
      const node = newRequestNode(`${request.method} ${new URL(/^https?:/.test(request.url) ? request.url : `https://${request.url}`).pathname || request.url}`, request);
      addNode(activeCollectionId, null, node);
      toast.success('Added to collection', node.name);
    } else {
      openTab({ request, name: `${request.method} request` });
      toast.success('Opened in a new tab');
    }
  };

  const insertScript = (script: string, kind: 'pre' | 'test') => {
    if (!activeTab || activeTab.kind !== 'http') return;
    const field = kind === 'pre' ? 'preRequestScript' : 'testScript';
    const existing = activeTab.request[field]?.trim();
    const next = existing ? `${existing}\n\n${script}\n` : `${script}\n`;
    writeTabRequest(activeTab.id, { ...activeTab.request, [field]: next });
    setSession('requestTab', 'scripts');
    toast.success(kind === 'pre' ? 'Added to pre-request script' : 'Added to test script');
  };

  interface QuickAction {
    label: string;
    icon: React.ReactNode;
    onSelect: () => void;
  }
  const quickActions: QuickAction[] = [];
  if (run.result && !run.result.ok) {
    quickActions.push({ label: 'Explain this error', icon: <AlertTriangle size={11} />, onSelect: () => ask('Why did this request fail? Suggest what to check or change.') });
  }
  if (run.result?.ok) {
    quickActions.push({ label: 'Explain this response', icon: <FileText size={11} />, onSelect: () => ask('Explain this response — what it means and anything worth noting about it.') });
  }
  if (canAttach) {
    quickActions.push({
      label: 'Write a pre-request script',
      icon: <Braces size={11} />,
      onSelect: () => ask('Write a pre-request script for this request (e.g. to sign it or derive a variable it needs).'),
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <Sparkles size={11} className={loading ? 'text-accent' : undefined} /> Ask Claude
        </span>
        <div className="flex items-center gap-0.5">
          <Button size="sm" onClick={() => openTab()}>
            <Plus size={11} /> New tab
          </Button>
          {messages.length > 0 && (
            <Button size="sm" onClick={clear}>
              <Trash2 size={11} /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Always-present strip, so the panel still reads as working when the
          newest turn has scrolled out of view. */}
      <div className="h-0.5 shrink-0 overflow-hidden">{loading && <div className="shimmer h-full w-full" />}</div>

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3">
            <EmptyState
              icon={<Bot size={22} />}
              title="Describe the request you want"
              detail="Claude replies with a ready-to-send request you can drop straight into a collection. Pasting a curl command works too."
            />
            <div className="flex flex-col gap-1.5">
              {STARTERS.map((starter, i) => (
                <button
                  key={starter}
                  onClick={() => ask(starter)}
                  style={{ animationDelay: `${i * 45}ms`, animationFillMode: 'backwards' }}
                  className="animate-rise rounded-md border border-line bg-surface px-2.5 py-2 text-left text-[12px] text-dim transition-all duration-100 hover:-translate-y-px hover:border-accent hover:text-fg"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <ChatBubble key={i} turn={m} onUseRequest={useRequest} onInsertScript={insertScript} />
            ))}
            {loading && (
              <div className="animate-rise flex items-center gap-2">
                <span className="dot-pulse flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                <Thinking label="Claude is thinking…" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {(canAttach || quickActions.length > 0) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {canAttach && (
              <Checkbox
                checked={attachContext}
                onChange={setAttachContext}
                label={`Attach ${activeTab!.name}${run.result ? ' + its response' : ''}`}
              />
            )}
          </div>
        )}
        {quickActions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={action.onSelect}
                disabled={loading}
                className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-dim transition-colors duration-100 hover:border-accent hover:text-fg disabled:opacity-40"
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div
          className={clsx(
            'flex items-end gap-2 rounded-md border bg-surface p-1.5 transition-colors duration-150 focus-within:border-accent',
            loading ? 'border-accent/40' : 'border-line',
          )}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={loading ? 'Claude is still replying — you can keep typing…' : 'Describe the API call you want…'}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(draft);
            }}
            className="h-12 flex-1 resize-none bg-transparent px-1 text-[12.5px] focus:outline-none"
          />
          <Button variant="primary" onClick={() => ask(draft)} disabled={loading || !draft.trim()}>
            <CornerDownLeft size={12} /> Send
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10.5px] text-faint">⌘↵ to send · runs through your own claude CLI</p>
      </div>
    </div>
  );
}

function ChatBubble({
  turn,
  onUseRequest,
  onInsertScript,
}: {
  turn: { role: 'user' | 'assistant'; text: string };
  onUseRequest: (r: RequestDef) => void;
  onInsertScript: (script: string, kind: 'pre' | 'test') => void;
}) {
  const isUser = turn.role === 'user';
  const request = !isUser ? extractAiRequest(turn.text) : null;
  const script = !isUser && !request ? extractScriptBlock(turn.text) : null;
  const displayText = isUser ? turn.text : stripAiRequestBlock(turn.text);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(turn.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={`animate-rise group flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12.5px] leading-relaxed transition-shadow duration-150 ${
          isUser ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg hover:shadow-sm'
        }`}
      >
        {displayText || (request ? 'Here’s a request for that:' : '')}
      </div>

      {!isUser && (
        <button
          onClick={copy}
          title="Copy reply"
          className="flex items-center gap-1 px-1 text-[10.5px] text-faint opacity-0 transition-opacity duration-100 hover:text-dim group-hover:opacity-100"
        >
          {copied ? <Check size={10} className="text-ok" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}

      {request && (
        <div className="animate-rise flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 transition-colors duration-150 hover:border-accent">
          <span className="shrink-0 text-[10px] font-bold" style={{ color: methodVar(request.method) }}>
            {request.method}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-dim">{request.url}</span>
          <Button size="sm" variant="primary" onClick={() => onUseRequest(request)}>
            Use
          </Button>
        </div>
      )}

      {script && (
        <div className="animate-rise flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 transition-colors duration-150 hover:border-accent">
          <Braces size={12} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">Script for the open request</span>
          <Button size="sm" onClick={() => onInsertScript(script, 'pre')}>
            Add to pre-request
          </Button>
          <Button size="sm" variant="primary" onClick={() => onInsertScript(script, 'test')}>
            Add to tests
          </Button>
        </div>
      )}
    </div>
  );
}
