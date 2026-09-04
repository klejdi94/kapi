import { useState } from 'react';
import { BookOpen, Trash2, WrapText } from 'lucide-react';
import type { ResponseView, SavedExample } from '@/types';
import { Segmented, IconButton, EmptyState, Spinner, Badge } from '@/components/ui/primitives';
import { ResponseMeta } from './ResponseMeta';
import { PrettyView, RawView, PreviewView, HeadersView, CookiesView, TimingsView } from './Views';
import { JsonTree } from './JsonTree';
import { ErrorView } from './ErrorView';
import { useSession } from '@/store/session';
import type { RunResult } from '@/types';
import { extensionFor, mimeOf, formatRelativeTime, statusTone } from '@/lib/format';
import { Send } from 'lucide-react';

export function ResponseViewer({
  run,
  loading,
  onSaveExample,
  examples,
  onLoadExample,
  onDeleteExample,
}: {
  run: RunResult | null;
  loading: boolean;
  onSaveExample?: () => void;
  examples?: SavedExample[];
  onLoadExample?: (example: SavedExample) => void;
  onDeleteExample?: (id: string) => void;
}) {
  const view = useSession((s) => s.responseView);
  const setView = useSession((s) => s.set);
  const wrap = useSession((s) => s.wrapLines);
  const [examplesOpen, setExamplesOpen] = useState(false);

  if (loading && !run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-faint">
        <Spinner className="h-6 w-6" />
        <span className="text-[12px]">Sending…</span>
      </div>
    );
  }

  if (!run) {
    return (
      <EmptyState
        icon={<Send size={28} />}
        title="Send a request to see the response here"
        detail="Method, headers, body and auth all live on the left. Nothing is sent anywhere until you hit Send."
        action={
          examples && examples.length > 0 && onLoadExample ? (
            <div className="flex flex-col items-center gap-1.5">
              <p className="text-[11px] text-faint">or load a saved example</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {examples.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => onLoadExample(ex)}
                    className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-dim hover:border-accent hover:text-fg"
                  >
                    <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
                    {ex.name}
                  </button>
                ))}
              </div>
            </div>
          ) : undefined
        }
      />
    );
  }

  if (!run.ok) {
    return <ErrorView error={run.error} />;
  }

  const response = run.response;
  const isJsonish = view === 'tree';
  let jsonValue: unknown = null;
  let jsonParseError: string | null = null;
  if (isJsonish) {
    try {
      jsonValue = response.text ? JSON.parse(response.text) : null;
    } catch (err) {
      jsonParseError = (err as Error).message;
    }
  }

  const cookieCount = response.headers.filter(([n]) => n.toLowerCase() === 'set-cookie').length;

  const download = () => {
    if (!response.blob) return;
    const mime = mimeOf(response.contentType);
    const url = URL.createObjectURL(response.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response.${extensionFor(mime)}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <ResponseMeta response={response} onDownload={download} onSaveExample={onSaveExample} />

      <div className="flex items-center justify-between border-b border-line px-3">
        <Segmented
          value={view}
          onChange={(v) => setView('responseView', v as ResponseView)}
          options={
            [
              { value: 'pretty', label: 'Pretty' },
              { value: 'tree', label: 'Tree' },
              { value: 'raw', label: 'Raw' },
              { value: 'preview', label: 'Preview' },
              { value: 'headers', label: 'Headers', count: response.headers.length },
              { value: 'cookies', label: 'Cookies', count: cookieCount },
              { value: 'timings', label: 'Timings' },
            ] as const
          }
        />
        <div className="flex items-center gap-0.5">
          {examples && examples.length > 0 && (
            <div className="relative">
              <IconButton label="Saved examples" active={examplesOpen} onClick={() => setExamplesOpen((o) => !o)}>
                <BookOpen size={13} />
              </IconButton>
              {examplesOpen && (
                <div
                  className="animate-in absolute right-0 top-[calc(100%+4px)] z-30 w-64 overflow-hidden rounded-lg border border-line bg-surface-2 py-1 shadow-2xl"
                  style={{ boxShadow: 'var(--shadow)' }}
                >
                  {examples.map((ex) => (
                    <div key={ex.id} className="group flex items-center gap-1 px-1">
                      <button
                        onClick={() => {
                          onLoadExample?.(ex);
                          setExamplesOpen(false);
                        }}
                        className="flex h-8 flex-1 items-center gap-2 rounded px-2 text-left text-[12px] hover:bg-surface-3"
                      >
                        <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
                        <span className="min-w-0 flex-1 truncate">{ex.name}</span>
                        <span className="shrink-0 text-[10px] text-faint">{formatRelativeTime(ex.savedAt)}</span>
                      </button>
                      {onDeleteExample && (
                        <IconButton label="Delete example" tone="danger" onClick={() => onDeleteExample(ex.id)}>
                          <Trash2 size={12} />
                        </IconButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {(view === 'pretty' || view === 'raw') && (
            <IconButton label="Wrap long lines" active={wrap} onClick={() => setView('wrapLines', !wrap)}>
              <WrapText size={13} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === 'pretty' && <PrettyView response={response} wrap={wrap} />}
        {view === 'raw' && <RawView response={response} wrap={wrap} />}
        {view === 'preview' && <PreviewView response={response} />}
        {view === 'headers' && <HeadersView response={response} />}
        {view === 'cookies' && <CookiesView response={response} />}
        {view === 'timings' && <TimingsView response={response} />}
        {view === 'tree' &&
          (jsonParseError ? (
            <EmptyState title="This response isn't valid JSON" detail={jsonParseError} />
          ) : (
            <JsonTree value={jsonValue} />
          ))}
      </div>
    </div>
  );
}
