import { useEffect, useRef, useState } from 'react';
import { Bot, Plus, Sparkles, Terminal, Trash2 } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Thinking } from '@/components/ui/Thinking';
import { useAiChat } from '@/store/aiChat';
import { askClaude, claudeAvailable, isClaudeCliInstalled } from '@/lib/claudeCli';
import { extractAiRequest, stripAiRequestBlock } from '@/lib/aiRequestParse';
import { useSession } from '@/store/session';
import { useWorkspaces } from '@/store/workspaces';
import { newRequestNode } from '@/lib/factory';
import { toast } from '@/lib/toast';
import type { RequestDef } from '@/types';

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
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
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

  const send = async () => {
    const text = draft.trim();
    if (!text || loading) return;
    setDraft('');
    const history = [...messages, { role: 'user' as const, text }];
    addMessage({ role: 'user', text });
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
          <Sparkles size={11} /> Ask Claude
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

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Bot size={22} />}
            title="Describe the request you want"
            detail={'Try: "a GET to the GitHub API for a user\'s public repos" or paste a curl command and ask for tweaks.'}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <ChatBubble key={i} turn={m} onUseRequest={useRequest} />
            ))}
            {loading && <Thinking />}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={loading ? 'Claude is still replying — you can keep typing…' : 'Describe the API call you want…'}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          className="h-14 flex-1 resize-none rounded-md border border-line bg-surface p-2 text-[12.5px] focus:border-accent focus:outline-none"
        />
        <Button variant="primary" onClick={send} disabled={loading || !draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}

function ChatBubble({ turn, onUseRequest }: { turn: { role: 'user' | 'assistant'; text: string }; onUseRequest: (r: RequestDef) => void }) {
  const isUser = turn.role === 'user';
  const request = !isUser ? extractAiRequest(turn.text) : null;
  const displayText = isUser ? turn.text : stripAiRequestBlock(turn.text);

  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap ${
          isUser ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg'
        }`}
      >
        {displayText || (request ? 'Here’s a request for that:' : '')}
      </div>
      {request && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5">
          <span className="font-mono text-[11.5px] text-dim">
            {request.method} {request.url}
          </span>
          <Button size="sm" variant="primary" onClick={() => onUseRequest(request)}>
            Use this request
          </Button>
        </div>
      )}
    </div>
  );
}
