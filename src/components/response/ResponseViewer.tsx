import { WrapText } from 'lucide-react';
import type { ResponseView } from '@/types';
import { Segmented, IconButton, EmptyState, Spinner } from '@/components/ui/primitives';
import { ResponseMeta } from './ResponseMeta';
import { PrettyView, RawView, PreviewView, HeadersView, CookiesView, TimingsView } from './Views';
import { JsonTree } from './JsonTree';
import { ErrorView } from './ErrorView';
import { useSession } from '@/store/session';
import type { RunResult } from '@/types';
import { extensionFor, mimeOf } from '@/lib/format';
import { Send } from 'lucide-react';

export function ResponseViewer({
  run,
  loading,
}: {
  run: RunResult | null;
  loading: boolean;
}) {
  const view = useSession((s) => s.responseView);
  const setView = useSession((s) => s.set);
  const wrap = useSession((s) => s.wrapLines);

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
      <ResponseMeta response={response} onDownload={download} />

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
        {(view === 'pretty' || view === 'raw') && (
          <IconButton label="Wrap long lines" active={wrap} onClick={() => setView('wrapLines', !wrap)}>
            <WrapText size={13} />
          </IconButton>
        )}
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
