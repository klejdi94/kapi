import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Bot, Check, Copy, CornerDownLeft, Plus, Sparkles, Terminal, Trash2 } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Thinking } from '@/components/ui/Thinking';
import { useAiChat } from '@/store/aiChat';
import { askClaude, claudeAvailable, isClaudeCliInstalled } from '@/lib/claudeCli';
import { extractAiRequest, stripAiRequestBlock } from '@/lib/aiRequestParse';
import { useSession } from '@/store/session';
import { useWorkspaces } from '@/store/workspaces';
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
  const activeCollectionId = useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.collections[0]?.id ?? null);
  const addNode = useWorkspaces((s) => s.addNode);

  const [draft, setDraft] = useState('');
  const [installed, setInstalled] = useState<boolean | null>(null);
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

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setDraft('');
    const history = [...messages, { role: 'user' as const, text: trimmed }];
    addMessage({ role: 'user', text: trimmed });
    setLoading(true);
    try {
      const reply = await askClaude(history);
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
              <ChatBubble key={i} turn={m} onUseRequest={useRequest} />
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

function ChatBubble({ turn, onUseRequest }: { turn: { role: 'user' | 'assistant'; text: string }; onUseRequest: (r: RequestDef) => void }) {
  const isUser = turn.role === 'user';
  const request = !isUser ? extractAiRequest(turn.text) : null;
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
    </div>
  );
}
