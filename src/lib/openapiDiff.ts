/**
 * Structural diff between two OpenAPI/Swagger documents, at the path+method
 * level — enough to tell an AI (or a person) what changed between two
 * imports of the same backend's spec, without trying to diff full JSON
 * schemas line by line. Pure and dependency-free so it's usable from both
 * the `kapi-mcp` server and, later, the GUI.
 */

interface OaDocLike {
  paths?: Record<string, unknown>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function operationsOf(doc: OaDocLike): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (operations as Record<string, unknown>)[method];
      if (op !== undefined) out.set(`${method.toUpperCase()} ${path}`, op);
    }
  }
  return out;
}

/** Cheap structural fingerprint — order-independent, good enough to tell "did this operation change". */
function fingerprint(op: unknown): string {
  return JSON.stringify(op, Object.keys(op as object).sort());
}

export interface OpenApiDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

export function diffOpenApiSpecs(oldDoc: OaDocLike | null, newDoc: OaDocLike): OpenApiDiff {
  const newOps = operationsOf(newDoc);
  if (!oldDoc) return { added: [...newOps.keys()].sort(), removed: [], changed: [], unchanged: 0 };

  const oldOps = operationsOf(oldDoc);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;

  for (const key of newOps.keys()) {
    if (!oldOps.has(key)) added.push(key);
    else if (fingerprint(oldOps.get(key)) !== fingerprint(newOps.get(key))) changed.push(key);
    else unchanged++;
  }
  for (const key of oldOps.keys()) {
    if (!newOps.has(key)) removed.push(key);
  }

  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), unchanged };
}

export function hasChanges(diff: OpenApiDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
