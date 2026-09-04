import { useEffect, useState } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';
import { dismissToast, subscribeToasts, type Toast } from '@/lib/toast';
import { IconButton } from './primitives';

const ICONS = { success: CheckCircle2, error: XCircle, warn: TriangleAlert, info: Info };
const TONES = { success: 'text-ok', error: 'text-danger', warn: 'text-warn', info: 'text-info' };

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="animate-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3 shadow-lg"
            style={{ boxShadow: 'var(--shadow)' }}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${TONES[t.kind]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium leading-snug text-fg">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{t.detail}</p>}
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.run();
                    dismissToast(t.id);
                  }}
                  className="mt-1.5 text-[11.5px] font-semibold text-accent hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <IconButton label="Dismiss" onClick={() => dismissToast(t.id)} className="-mr-1 -mt-1">
              <X size={13} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
