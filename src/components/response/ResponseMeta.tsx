import { Copy, Download } from 'lucide-react';
import type { KapiResponse } from '@/types';
import { formatBytes, formatDuration, statusText, statusTone } from '@/lib/format';
import { Badge, IconButton } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';

const TONE_MAP = { ok: 'ok', info: 'info', warn: 'warn', danger: 'danger', dim: 'dim' } as const;

export function ResponseMeta({ response, onDownload }: { response: KapiResponse; onDownload: () => void }) {
  const tone = TONE_MAP[statusTone(response.status)];

  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(response.text);
      toast.success('Copied response body');
    } catch {
      toast.error('Could not copy', 'Clipboard access was denied by the browser.');
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
      <Badge tone={tone} className="text-[12px]">
        {response.status} {statusText(response.status, response.statusText)}
      </Badge>
      <span className="tnum text-[12px] text-dim">{formatDuration(response.timings.total)}</span>
      <span className="tnum text-[12px] text-dim">{formatBytes(response.size.body)}</span>
      {response.redirected && <Badge tone="info">redirected</Badge>}

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="Copy body" onClick={copyBody}>
          <Copy size={13} />
        </IconButton>
        <IconButton label="Download response" onClick={onDownload}>
          <Download size={13} />
        </IconButton>
      </div>
    </div>
  );
}
