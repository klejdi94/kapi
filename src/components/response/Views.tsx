import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { KapiResponse } from '@/types';
import { CodeEditor } from '@/components/ui/Editor';
import { EmptyState } from '@/components/ui/primitives';
import { formatBytes, formatDuration, languageFor, parseSetCookie, previewKind, statusTone } from '@/lib/format';

/* -------------------------------------------------------------------- pretty */

export function PrettyView({ response, wrap }: { response: KapiResponse; wrap: boolean }) {
  const [forceShow, setForceShow] = useState(false);

  const language = useMemo(() => languageFor(response.contentType, response.text.slice(0, 200)), [response]);
  const pretty = useMemo(() => {
    if (language !== 'json') return response.text;
    try {
      return JSON.stringify(JSON.parse(response.text), null, 2);
    } catch {
      return response.text;
    }
  }, [response.text, language]);

  if (response.binary) return <BinaryNotice response={response} />;
  if (!response.text) return <EmptyState title="Empty response body" />;

  const isLarge = response.text.length > 2_000_000;
  if (isLarge && !forceShow) {
    return (
      <EmptyState
        title={`This response is ${formatBytes(response.size.body)}`}
        detail="Large bodies aren't auto-rendered to keep things responsive."
        action={
          <button onClick={() => setForceShow(true)} className="text-[12px] font-semibold text-accent hover:underline">
            Show anyway
          </button>
        }
      />
    );
  }

  return <CodeEditor value={pretty} language={language === 'binary' ? 'text' : language} readOnly wrap={wrap} />;
}

/* ---------------------------------------------------------------------- raw */

export function RawView({ response, wrap }: { response: KapiResponse; wrap: boolean }) {
  if (response.binary) return <BinaryNotice response={response} />;
  if (!response.text) return <EmptyState title="Empty response body" />;
  return <CodeEditor value={response.text} language="text" readOnly wrap={wrap} />;
}

/* ------------------------------------------------------------------ preview */

export function PreviewView({ response }: { response: KapiResponse }) {
  const kind = useMemo(() => previewKind(response.contentType.split(';')[0].trim().toLowerCase()), [response]);
  const url = useMemo(() => (response.blob ? URL.createObjectURL(response.blob) : null), [response.blob]);

  if (kind === 'none') {
    return <EmptyState title="No preview available for this content type" detail={response.contentType} />;
  }
  if (!url) return <EmptyState title="No body to preview" />;

  if (kind === 'html') {
    return <iframe title="Response preview" src={url} sandbox="" className="h-full w-full border-0 bg-white" />;
  }
  if (kind === 'image') {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
        <img src={url} alt="Response" className="max-h-full max-w-full rounded shadow-lg" />
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div className="flex h-full items-center justify-center">
        <audio controls src={url} className="w-full max-w-md" />
      </div>
    );
  }
  if (kind === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <video controls src={url} className="max-h-full max-w-full" />
      </div>
    );
  }
  return <iframe title="Response preview" src={url} className="h-full w-full border-0" />;
}

function BinaryNotice({ response }: { response: KapiResponse }) {
  return (
    <EmptyState
      icon={<AlertTriangle size={22} />}
      title="This response isn't text"
      detail={`${response.contentType || 'unknown type'} · ${formatBytes(response.size.body)}. Use the Preview tab, or download it.`}
    />
  );
}

/* ------------------------------------------------------------------- headers */

export function HeadersView({ response }: { response: KapiResponse }) {
  if (!response.headers.length) return <EmptyState title="No response headers" />;
  return (
    <div className="p-3">
      <div className="overflow-hidden rounded-md border border-line">
        <div className="grid grid-cols-[minmax(140px,1fr)_2fr] gap-px bg-line">
          {response.headers.map(([name, value], i) => (
            <div key={`${name}-${i}`} className="contents">
              <div className="bg-surface px-2.5 py-1.5 font-mono text-[12px] text-dim">{name}</div>
              <div className="break-all bg-surface px-2.5 py-1.5 font-mono text-[12px] text-fg">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- cookies */

export function CookiesView({ response }: { response: KapiResponse }) {
  const cookies = response.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, v]) => parseSetCookie(v));
  if (!cookies.length) return <EmptyState title="No cookies were set by this response" />;
  return (
    <div className="overflow-auto p-3">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-faint">
            {['Name', 'Value', 'Domain', 'Path', 'Expires', 'Flags'].map((h) => (
              <th key={h} className="border-b border-line py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={i} className="align-top">
              <td className="border-b border-line py-1.5 pr-3 font-mono font-medium text-fg">{c.name}</td>
              <td className="max-w-[200px] truncate border-b border-line py-1.5 pr-3 font-mono text-dim" title={c.value}>{c.value}</td>
              <td className="border-b border-line py-1.5 pr-3 text-dim">{c.domain || '—'}</td>
              <td className="border-b border-line py-1.5 pr-3 text-dim">{c.path || '—'}</td>
              <td className="border-b border-line py-1.5 pr-3 text-dim">{c.expires || c.maxAge || 'Session'}</td>
              <td className="border-b border-line py-1.5 pr-3 text-faint">
                {[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite].filter(Boolean).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- timings */

export function TimingsView({ response }: { response: KapiResponse }) {
  const { ttfb, total } = response.timings;
  const download = Math.max(0, total - ttfb);
  const bars = [
    { label: 'Time to first byte', value: ttfb, color: 'var(--info)' },
    { label: 'Content download', value: download, color: 'var(--ok)' },
  ];
  const max = Math.max(total, 1);

  return (
    <div className="max-w-lg p-4">
      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tnum">{formatDuration(total)}</span>
        <span className="text-[12px] text-faint">total</span>
      </div>
      <div className="flex flex-col gap-3">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="mb-1 flex items-center justify-between text-[11.5px]">
              <span className="text-dim">{bar.label}</span>
              <span className="tnum text-faint">{formatDuration(bar.value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, (bar.value / max) * 100)}%`, background: bar.color }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        Measured from just before the request left to the last byte of the body. A DNS/TLS/connect breakdown
        isn't currently surfaced by the native HTTP client.
      </p>
    </div>
  );
}

export function statusBadgeTone(status: number) {
  return statusTone(status);
}
