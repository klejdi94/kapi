import { AlertOctagon, Ban, Clock, Globe, ShieldAlert, Wifi, XCircle } from 'lucide-react';
import type { KapiError } from '@/types';
import { formatDuration } from '@/lib/format';

const ICONS: Record<KapiError['kind'], typeof Globe> = {
  dns: Globe,
  refused: Wifi,
  tls: ShieldAlert,
  timeout: Clock,
  aborted: Ban,
  blocked: ShieldAlert,
  invalid: AlertOctagon,
  unknown: XCircle,
};

export function ErrorView({ error }: { error: KapiError }) {
  const Icon = ICONS[error.kind];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Icon size={28} className="text-danger" />
      <div className="max-w-md space-y-1.5">
        <p className="text-[13.5px] font-semibold text-fg">{error.title}</p>
        <p className="text-[12.5px] leading-relaxed text-dim">{error.detail}</p>
      </div>
      <p className="text-[11px] text-faint">{formatDuration(error.elapsed)}</p>
    </div>
  );
}
