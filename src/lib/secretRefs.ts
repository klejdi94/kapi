import type { VarScope } from './variables';
import { collectUsages } from './variables';

/**
 * External secret references: an environment or global variable whose value
 * is `op://vault/item/field` (1Password), `awssm://secret-id#key?region=…`
 * (AWS Secrets Manager) or `vault://path#field` (HashiCorp Vault) is replaced
 * by the real secret right before a request is sent — by the manager's own
 * CLI, through a resolver the host registers (the desktop app asks for
 * consent per reference natively; the CLI only with --secret-refs).
 *
 * Collection variables are never resolved: a collection is the thing people
 * share and import, so a reference in one could be a trap. The value never
 * enters the persisted scope, scripts see the reference string, and the
 * resolved value is cached in memory only, for a few minutes.
 */

const PATTERN = /^\s*(op|awssm|vault):\/\/\S+\s*$/;

export function isSecretRef(value: string | undefined | null): boolean {
  return !!value && PATTERN.test(value);
}

export function secretRefProvider(value: string): '1Password' | 'AWS Secrets Manager' | 'HashiCorp Vault' | null {
  const scheme = /^\s*(op|awssm|vault):\/\//.exec(value)?.[1];
  return scheme === 'op' ? '1Password' : scheme === 'awssm' ? 'AWS Secrets Manager' : scheme === 'vault' ? 'HashiCorp Vault' : null;
}

export type SecretRefResolver = (reference: string, purpose: string) => Promise<string>;

let resolver: SecretRefResolver | null = null;

/** Called once at startup by a host that can resolve references; without one, references are sent as written. */
export function setSecretRefResolver(next: SecretRefResolver | null): void {
  resolver = next;
  cache.clear();
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { value: string; at: number }>();
const inflight = new Map<string, Promise<string>>();

export function clearSecretRefCache(): void {
  cache.clear();
}

async function lookupRef(reference: string, purpose: string): Promise<string> {
  const key = reference.trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  // Concurrent sends (a load test, the runner) share one lookup instead of N prompts.
  let pending = inflight.get(key);
  if (!pending) {
    pending = resolver!(key, purpose).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const value = await pending;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/**
 * A copy of `scope` in which every environment/global variable that `texts`
 * uses (directly or through other variables) and that holds a reference has
 * its real value. Returns `scope` itself when there is nothing to resolve.
 * Throws with a readable message when a lookup fails or is refused.
 */
export async function withResolvedSecretRefs(texts: string[], scope: VarScope, purpose: string): Promise<VarScope> {
  if (!resolver) return scope;
  let resolved: VarScope | null = null;
  const done = new Set<string>();
  let frontier = texts;
  // Variables can reference other variables; follow a few levels, like resolve() does.
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: string[] = [];
    for (const usage of collectUsages(frontier, scope)) {
      if (done.has(usage.name) || !usage.entry) continue;
      done.add(usage.name);
      const { entry } = usage;
      if (isSecretRef(entry.value) && (entry.source === 'environment' || entry.source === 'global')) {
        let value: string;
        try {
          value = await lookupRef(entry.value, purpose);
        } catch (err) {
          throw new Error(`{{${usage.name}}} — ${err instanceof Error ? err.message : String(err)}`);
        }
        resolved ??= new Map(scope);
        resolved.set(usage.name, { ...entry, value });
      } else {
        next.push(entry.value);
      }
    }
    frontier = next;
  }
  return resolved ?? scope;
}
