import type { Collection, KV, RequestNode, TreeNode } from '@/types';

interface Located {
  node: RequestNode;
  tag: string | null;
}

function walkRequests(items: TreeNode[], tag: string | null, out: Located[]) {
  for (const item of items) {
    if (item.type === 'request') out.push({ node: item, tag });
    else if (item.type === 'folder') walkRequests(item.items, item.name, out);
  }
}

/** `https://api.example.com` or a `{{variable}}` prefix, whichever the URL starts with. */
function splitServerAndPath(url: string): { server: string; path: string } {
  const match = /^(https?:\/\/[^/]+|\{\{[^}]+\}\})/.exec(url);
  if (!match) return { server: '', path: url.startsWith('/') ? url : `/${url}` };
  const rest = url.slice(match[1].length).split(/[?#]/)[0];
  return { server: match[1], path: rest || '/' };
}

function paramSchema(rows: KV[], location: 'query' | 'header'): Record<string, unknown>[] {
  return rows
    .filter((r) => r.enabled && r.key.trim())
    .map((r) => ({
      name: r.key,
      in: location,
      required: location === 'header' ? false : !!r.value,
      schema: { type: 'string' },
      example: r.value || undefined,
    }));
}

function tryParseJson(text: string | undefined): unknown {
  if (!text?.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Best-effort reverse of `importers/openapi.ts` — enough to hand a
 * collection's shape (paths, methods, params, JSON bodies) to any tool that
 * reads OpenAPI, not a byte-perfect round trip. `{{variable}}` server
 * prefixes are carried through as literal text since kapi and OpenAPI use
 * different templating syntax; the exported spec still documents correctly,
 * it just needs the server URL filled in by hand.
 */
export function exportOpenApi(collection: Collection): object {
  const requests: Located[] = [];
  walkRequests(collection.items, null, requests);

  const serverCounts = new Map<string, number>();
  for (const { node } of requests) {
    const { server } = splitServerAndPath(node.request.url);
    if (server) serverCounts.set(server, (serverCounts.get(server) ?? 0) + 1);
  }
  const server = [...serverCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'https://api.example.com';

  const paths: Record<string, Record<string, unknown>> = {};

  for (const { node, tag } of requests) {
    const { path: rawPath } = splitServerAndPath(node.request.url);
    const path = rawPath.replace(/:([A-Za-z_][A-Za-z0-9_-]*)/g, '{$1}');
    const method = node.request.method.toLowerCase();

    const pathParams = [...rawPath.matchAll(/:([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const bodyMode = node.request.body.mode;
    const jsonText = bodyMode === 'json' ? node.request.body.text.json : undefined;
    const requestBody =
      bodyMode === 'json'
        ? { content: { 'application/json': { schema: { type: 'object' }, example: tryParseJson(jsonText) } } }
        : bodyMode === 'xml'
          ? { content: { 'application/xml': { schema: { type: 'string' } } } }
          : bodyMode === 'urlencoded'
            ? { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } }
            : undefined;

    const firstExample = node.request.examples?.[0];

    paths[path] ??= {};
    paths[path][method] = {
      summary: node.name,
      description: node.description?.trim() || undefined,
      tags: tag ? [tag] : undefined,
      parameters: [
        ...pathParams,
        ...paramSchema(node.request.params, 'query'),
        ...paramSchema(node.request.headers, 'header'),
      ],
      requestBody,
      responses: {
        [String(firstExample?.status ?? 200)]: {
          description: firstExample?.name || 'OK',
          ...(firstExample ? { content: { 'application/json': { example: tryParseJson(firstExample.body) ?? firstExample.body } } } : {}),
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: { title: collection.name, description: collection.description || undefined, version: '1.0.0' },
    servers: [{ url: server }],
    paths,
  };
}
