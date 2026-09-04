import type { Collection, FolderNode, KV, RequestDef } from '@/types';
import { effectiveAuth } from './auth';
import { ancestorsOf } from './tree';

/**
 * Requests default to `auth: 'inherit'` — most obviously for anything imported
 * from Postman — so resolving that chain isn't optional polish, it's what
 * makes the request actually carry the auth the UI says it has. Builds a copy
 * of `request` with auth resolved and collection/folder headers merged in,
 * suitable for sending or generating code from. Never persisted back.
 */
export function resolveInherited(request: RequestDef, collection: Collection | null, folderChain: FolderNode[]): RequestDef {
  const { auth } = effectiveAuth([collection?.auth, ...folderChain.map((f) => f.auth), request.auth]);

  const ownKeys = new Set(request.headers.filter((r) => r.enabled && r.key.trim()).map((r) => r.key.trim().toLowerCase()));
  const inherited: KV[] = [...(collection?.headers ?? []), ...folderChain.flatMap((f) => f.headers)];
  const extraHeaders = inherited.filter((r) => r.enabled && r.key.trim() && !ownKeys.has(r.key.trim().toLowerCase()));

  if (auth === request.auth && extraHeaders.length === 0) return request;
  return { ...request, auth, headers: [...request.headers, ...extraHeaders] };
}

/** Convenience for call sites that only have the raw tree + a node id. */
export function resolveInheritedForNode(
  request: RequestDef,
  collection: Collection | null,
  nodeId: string | null,
): RequestDef {
  if (!collection || !nodeId) return request;
  return resolveInherited(request, collection, ancestorsOf(collection.items, nodeId));
}
