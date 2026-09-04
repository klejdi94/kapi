import type { RequestSettings } from '@/types';
import { Field, Checkbox } from '@/components/ui/primitives';

export function SettingsTab({ settings, onChange }: { settings: RequestSettings; onChange: (settings: RequestSettings) => void }) {
  const set = <K extends keyof RequestSettings>(key: K, value: RequestSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div className="flex max-w-lg flex-col gap-6 p-4">
      <Field label="Timeout" hint="How long to wait for a response before giving up.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1000}
            max={120000}
            step={1000}
            value={settings.timeoutMs}
            onChange={(e) => set('timeoutMs', Number(e.target.value))}
            className="w-48 accent-[var(--accent)]"
          />
          <span className="tnum w-14 text-[12.5px] text-dim">{(settings.timeoutMs / 1000).toFixed(0)}s</span>
        </div>
      </Field>

      <div className="flex flex-col gap-3">
        <Checkbox
          label="Follow redirects"
          hint="When off, kapi shows the 3xx response itself instead of chasing the Location header."
          checked={settings.followRedirects}
          onChange={(v) => set('followRedirects', v)}
        />
        <Checkbox
          label="Automatic headers"
          hint="Let kapi add Content-Type and Accept for you. Turn off for full manual control."
          checked={settings.autoHeaders}
          onChange={(v) => set('autoHeaders', v)}
        />
      </div>
    </div>
  );
}
