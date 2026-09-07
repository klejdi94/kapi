import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/primitives';
import { useTokenInspector } from '@/store/tokenInspector';
import { inspectToken, describeClaimTime, type TokenInspection } from '@/lib/tokenInspect';

function ClaimTime({ label, seconds }: { label: string; seconds: number | null }) {
  if (seconds === null) return null;
  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span className="w-10 shrink-0 text-faint">{label}</span>
      <span className="font-mono text-dim">{describeClaimTime(seconds)}</span>
    </div>
  );
}

function JwtView({ inspection }: { inspection: Extract<TokenInspection, { kind: 'jwt' }> }) {
  const now = Math.floor(Date.now() / 1000);
  const expired = inspection.exp !== null && inspection.exp < now;
  const notYetValid = inspection.nbf !== null && inspection.nbf > now;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {inspection.alg && <Badge tone="accent">{inspection.alg}</Badge>}
        {inspection.typ && <Badge tone="dim">{inspection.typ}</Badge>}
        {expired && <Badge tone="danger">Expired</Badge>}
        {notYetValid && <Badge tone="warn">Not yet valid</Badge>}
        {!expired && !notYetValid && inspection.exp !== null && <Badge tone="ok">Valid</Badge>}
      </div>

      {(inspection.exp !== null || inspection.iat !== null || inspection.nbf !== null) && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-2.5">
          <ClaimTime label="exp" seconds={inspection.exp} />
          <ClaimTime label="iat" seconds={inspection.iat} />
          <ClaimTime label="nbf" seconds={inspection.nbf} />
        </div>
      )}

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Header</div>
        <pre className="overflow-auto rounded-md border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
          {JSON.stringify(inspection.header, null, 2)}
        </pre>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Payload</div>
        <pre className="overflow-auto rounded-md border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
          {JSON.stringify(inspection.payload, null, 2)}
        </pre>
      </div>
      <p className="text-[10.5px] text-faint">
        The signature isn't verified — there's no key to check it against here, just the decoded claims.
      </p>
    </div>
  );
}

function SamlView({ inspection }: { inspection: Extract<TokenInspection, { kind: 'saml' }> }) {
  const failed = inspection.statusCode && !inspection.statusCode.endsWith(':Success');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{inspection.binding === 'post' ? 'POST binding' : 'Redirect binding'}</Badge>
        {inspection.statusCode && <Badge tone={failed ? 'danger' : 'ok'}>{inspection.statusCode.split(':').pop()}</Badge>}
      </div>
      <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-2.5 text-[11.5px]">
        {inspection.issuer && <div><span className="text-faint">Issuer </span><span className="font-mono text-dim">{inspection.issuer}</span></div>}
        {inspection.nameId && <div><span className="text-faint">NameID </span><span className="font-mono text-dim">{inspection.nameId}</span></div>}
        {inspection.audience && <div><span className="text-faint">Audience </span><span className="font-mono text-dim">{inspection.audience}</span></div>}
        {inspection.notBefore && <div><span className="text-faint">Not before </span><span className="font-mono text-dim">{new Date(inspection.notBefore).toLocaleString()}</span></div>}
        {inspection.notOnOrAfter && <div><span className="text-faint">Not on/after </span><span className="font-mono text-dim">{new Date(inspection.notOnOrAfter).toLocaleString()}</span></div>}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">XML</div>
        <pre className="max-h-72 overflow-auto rounded-md border border-line bg-surface p-2.5 font-mono text-[11.5px] leading-relaxed text-dim">
          {inspection.xml}
        </pre>
      </div>
    </div>
  );
}

/** Paste a JWT or a SAMLResponse and see it decoded — nothing leaves the app, there's no network call involved. */
export function TokenInspectorModal() {
  const open = useTokenInspector((s) => s.open);
  const initialValue = useTokenInspector((s) => s.initialValue);
  const close = useTokenInspector((s) => s.close);

  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<TokenInspection | { error: string } | null>(null);

  useEffect(() => {
    if (open) setRaw(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    let cancelled = false;
    if (!raw.trim()) {
      setResult(null);
      return;
    }
    inspectToken(raw).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [raw]);

  if (!open) return null;

  return (
    <Modal open onClose={close} title="Inspect a token" width={620}>
      <div className="flex flex-col gap-3">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Paste a JWT (eyJhbGci...) or a SAMLResponse value…"
          rows={3}
          spellCheck={false}
          className="w-full resize-none rounded-md border border-line bg-surface p-2.5 font-mono text-[11.5px] focus:border-accent focus:outline-none"
        />
        {raw.trim() && !result && <p className="text-[11.5px] text-faint">Doesn't look like a JWT or a SAML response.</p>}
        {result && 'error' in result && <p className="text-[11.5px] text-warn">{result.error}</p>}
        {result && !('error' in result) && (result.kind === 'jwt' ? <JwtView inspection={result} /> : <SamlView inspection={result} />)}
      </div>
    </Modal>
  );
}
