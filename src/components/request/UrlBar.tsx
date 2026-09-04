import { useState } from 'react';
import { ChevronDown, Code2, History, Loader2, Send, Star, X } from 'lucide-react';
import { MethodSelect } from './MethodSelect';
import { IconButton } from '@/components/ui/primitives';
import type { HttpMethod } from '@/types';

export function UrlBar({
  method,
  url,
  onMethod,
  onUrl,
  onSend,
  onCancel,
  onSave,
  onImportCurl,
  onGenerateCode,
  loading,
  dirty,
  invalidVars,
}: {
  method: HttpMethod;
  url: string;
  onMethod: (m: HttpMethod) => void;
  onUrl: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onSave: () => void;
  onImportCurl: (curl: string) => boolean;
  onGenerateCode: () => void;
  loading: boolean;
  dirty: boolean;
  invalidVars: string[];
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="flex items-stretch gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-stretch">
        <MethodSelect value={method} onChange={onMethod} />
        <div className="relative min-w-0 flex-1">
          <input
            value={url}
            onChange={(e) => {
              // Pasting a full cURL command builds the whole request in one go.
              const text = e.target.value;
              if (/^\s*curl\s/i.test(text) && onImportCurl(text)) return;
              onUrl(text);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSend();
            }}
            placeholder="https://api.example.com/v1/resource or paste a cURL command"
            spellCheck={false}
            autoComplete="off"
            className="h-9 w-full border-y border-r border-line bg-surface px-3 font-mono text-[12.5px] text-fg placeholder:font-sans placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
          />
          {!focused && invalidVars.length > 0 && (
            <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
              <span title={`Undefined: ${invalidVars.join(', ')}`} className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">
                {invalidVars.length} undefined
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="flex h-9 w-8 items-center justify-center rounded-r-md border border-l-0 border-line bg-surface text-faint hover:bg-surface-2 hover:text-fg"
          title="Request history for this URL"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {loading ? (
        <button
          onClick={onCancel}
          className="flex h-9 items-center gap-1.5 rounded-md bg-danger px-3.5 text-[12.5px] font-semibold text-white hover:brightness-110"
        >
          <X size={14} />
          Cancel
        </button>
      ) : (
        <button
          onClick={onSend}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-4 text-[12.5px] font-semibold text-accent-fg shadow-sm hover:brightness-110 active:brightness-95"
        >
          <Send size={13} />
          Send
        </button>
      )}

      <IconButton label="Generate code" onClick={onGenerateCode} className="h-9 w-9 shrink-0 rounded-md border border-line">
        <Code2 size={15} />
      </IconButton>

      <IconButton label={dirty ? 'Save (⌘S)' : 'Saved'} onClick={onSave} active={dirty} className="h-9 w-9 shrink-0 rounded-md border border-line">
        <Star size={15} fill={dirty ? 'none' : 'currentColor'} className={dirty ? '' : 'text-accent'} />
      </IconButton>
    </div>
  );
}

export function LoadingBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="h-[2px] w-full overflow-hidden bg-transparent">
      <div className="h-full w-1/3 animate-[kapi-loading_1.1s_ease-in-out_infinite] bg-accent" />
      <style>{`@keyframes kapi-loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
    </div>
  );
}

export function HistoryIcon() {
  return <History size={13} />;
}

export function SpinnerIcon() {
  return <Loader2 size={13} className="animate-spin-slow" />;
}
