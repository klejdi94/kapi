import { useWorkspaces, activeWorkspace } from '@/store/workspaces';
import { kv, withTrailingBlank } from './factory';
import type { KV } from '@/types';

/**
 * Writes a single variable into the active environment, falling back to
 * globals when none is active — the two scopes every request can see.
 * Shared by the URL-variable editor and "save as variable" actions so the
 * precedence rule lives in exactly one place.
 */
export function upsertWorkspaceVariable(name: string, value: string) {
  const store = useWorkspaces.getState();
  const workspace = activeWorkspace(store);
  const environment = workspace.environments.find((e) => e.id === workspace.activeEnvironmentId);

  const upsert = (rows: KV[]): KV[] => {
    const index = rows.findIndex((r) => r.key.trim() === name);
    if (index === -1) return withTrailingBlank([...rows.filter((r) => r.key.trim()), kv({ key: name, value })]);
    const next = [...rows];
    next[index] = { ...next[index], value, enabled: true };
    return next;
  };

  if (environment) store.updateEnvironment(environment.id, { variables: upsert(environment.variables) });
  else store.setGlobals(upsert(workspace.globals));
}
