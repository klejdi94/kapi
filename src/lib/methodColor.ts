import type { HttpMethod } from '@/types';

const VAR_NAMES: Record<string, string> = {
  GET: '--m-get', POST: '--m-post', PUT: '--m-put', PATCH: '--m-patch',
  DELETE: '--m-delete', HEAD: '--m-head', OPTIONS: '--m-options',
};

export function methodVar(method: HttpMethod): string {
  return `var(${VAR_NAMES[method.toUpperCase()] || '--m-other'})`;
}
