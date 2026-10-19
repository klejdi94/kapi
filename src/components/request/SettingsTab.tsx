import { useState } from 'react';
import type { RequestSettings, ResponseContract } from '@/types';
import { Field, Checkbox, Input } from '@/components/ui/primitives';

export function SettingsTab({
  settings,
  onChange,
  contract,
  onContractChange,
}: {
  settings: RequestSettings;
  onChange: (settings: RequestSettings) => void;
  contract?: ResponseContract;
  onContractChange?: (contract: ResponseContract) => void;
}) {
  const set = <K extends keyof RequestSettings>(key: K, value: RequestSettings[K]) => onChange({ ...settings, [key]: value });
  const [mtlsOpen, setMtlsOpen] = useState(!!(settings.clientCertPem || settings.clientKeyPem));

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

      {contract && onContractChange && (
        <div className="flex flex-col gap-2">
          <Checkbox
            label="Check responses against the OpenAPI contract"
            hint="This request came from an API spec. Every response is checked for a documented status and a body that matches its schema; results appear in the Tests tab."
            checked={contract.enabled}
            onChange={(enabled) => onContractChange({ ...contract, enabled })}
          />
          <div className="ml-6 flex flex-wrap gap-1.5 text-[11px]">
            {Object.entries(contract.responses).map(([status, r]) => (
              <span key={status} title={r.description} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-dim">
                {status}
                {r.schema ? ' · schema' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

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

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Network</h3>
        <Field label="Proxy" hint="e.g. http://localhost:8080 or socks5://localhost:1080. Empty means no proxy. {{variables}} work here too.">
          <Input
            value={settings.proxyUrl ?? ''}
            onChange={(e) => set('proxyUrl', e.target.value)}
            placeholder="http://localhost:8080"
            className="max-w-xs font-mono"
          />
        </Field>
        <Checkbox
          label="Skip certificate verification"
          hint="Accepts self-signed or otherwise untrusted certificates — for an internal CA you haven't imported. Only turn this on for hosts you trust."
          checked={!!settings.insecureSkipTlsVerify}
          onChange={(v) => set('insecureSkipTlsVerify', v)}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-5">
        <Checkbox
          label="Client certificate (mutual TLS)"
          hint="Presents a certificate to the server instead of just verifying its own. Routes this request through a separate client — form-data bodies aren't supported alongside it yet."
          checked={mtlsOpen}
          onChange={(v) => {
            setMtlsOpen(v);
            if (!v) onChange({ ...settings, clientCertPem: undefined, clientKeyPem: undefined, caCertPem: undefined });
          }}
        />
        {mtlsOpen && (
          <div className="flex flex-col gap-3 pl-1">
            <Field label="Client certificate (PEM)">
              <textarea
                value={settings.clientCertPem ?? ''}
                onChange={(e) => set('clientCertPem', e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={3}
                spellCheck={false}
                className="w-full resize-none rounded-md border border-line bg-surface p-2 font-mono text-[11.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Private key (PEM)">
              <textarea
                value={settings.clientKeyPem ?? ''}
                onChange={(e) => set('clientKeyPem', e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                rows={3}
                spellCheck={false}
                className="w-full resize-none rounded-md border border-line bg-surface p-2 font-mono text-[11.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Custom CA certificate (PEM)" hint="Optional — trusted in addition to the system's own root store.">
              <textarea
                value={settings.caCertPem ?? ''}
                onChange={(e) => set('caCertPem', e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={3}
                spellCheck={false}
                className="w-full resize-none rounded-md border border-line bg-surface p-2 font-mono text-[11.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-faint">
              Paste PEM text directly, or reference a secret-flagged variable (e.g. <code className="text-dim">{'{{clientCert}}'}</code>) so
              the key material isn&rsquo;t sitting in the request itself.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
