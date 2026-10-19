import { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import type { KV } from '@/types';
import { IconButton } from '@/components/ui/primitives';
import { clearSecretRefCache, isSecretRef, secretRefProvider } from '@/lib/secretRefs';
import { isDesktop } from '@/lib/transport';
import { toast } from '@/lib/toast';

/**
 * Explains external references (op:// · awssm:// · vault://) under a variable
 * grid, lists which ones this grid uses, and the references the user has
 * allowed — with a way to revoke them. Approvals are granted only by the
 * native consent dialog (src-tauri/src/secret_refs.rs), never from here.
 */
export function ExternalSecrets({ rows }: { rows: KV[] }) {
  const [approved, setApproved] = useState<string[] | null>(null);
  const used = rows.filter((r) => r.enabled && r.key && isSecretRef(r.value));

  const load = async () => {
    if (!isDesktop()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    setApproved(await invoke<string[]>('kapi_secret_ref_approvals').catch(() => []));
  };
  useEffect(() => {
    void load();
  }, []);

  const revoke = async (reference: string) => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('kapi_secret_ref_revoke', { reference });
    clearSecretRefCache();
    toast.success('Access revoked', 'kapi will ask again the next time a request uses it.');
    await load();
  };

  return (
    <div className="rounded-md border border-line bg-surface-2/50 px-3 py-2 text-[11.5px] leading-relaxed text-faint">
      <div className="flex items-center gap-1.5 font-medium text-dim">
        <KeyRound size={12} /> External secrets
      </div>
      <p className="mt-1">
        Set a value to <code className="text-dim">op://vault/item/field</code>, <code className="text-dim">awssm://secret-id#key</code> or{' '}
        <code className="text-dim">vault://path#field</code> and kapi reads it with the 1Password, AWS or Vault CLI you're signed in to, right before each
        request — the secret is never stored in kapi. Each reference asks for your permission once.
      </p>
      {used.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {used.map((r) => (
            <li key={r.id}>
              <span className="font-mono text-dim">{r.key}</span> → {secretRefProvider(r.value)}
              {approved && !approved.includes(r.value.trim()) && <span className="ml-1 text-warn">(not yet allowed)</span>}
            </li>
          ))}
        </ul>
      )}
      {approved && approved.length > 0 && (
        <div className="mt-2">
          <div className="text-[10.5px] uppercase tracking-wider">Allowed references</div>
          {approved.map((reference) => (
            <div key={reference} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-dim" title={reference}>{reference}</span>
              <IconButton label="Revoke" onClick={() => revoke(reference)}>
                <X size={11} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
