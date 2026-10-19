import type { Collection, RequestNode, TreeNode } from '@/types';

function requestLines(node: RequestNode, heading: string): string[] {
  const lines: string[] = [`${heading} ${node.name}`, '', `\`${node.request.method} ${node.request.url}\``, ''];
  if (node.description?.trim()) lines.push(node.description.trim(), '');

  const headers = node.request.headers.filter((h) => h.enabled && h.key.trim());
  if (headers.length) lines.push('**Headers**', '', ...headers.map((h) => `- \`${h.key}\`${h.value ? `: ${h.value}` : ''}`), '');

  const params = node.request.params.filter((p) => p.enabled && p.key.trim());
  if (params.length) lines.push('**Query params**', '', ...params.map((p) => `- \`${p.key}\`${p.value ? `: ${p.value}` : ''}`), '');

  if (node.request.pathVars.some((v) => v.key.trim())) {
    lines.push('**Path variables**', '', ...node.request.pathVars.filter((v) => v.key.trim()).map((v) => `- \`:${v.key}\``), '');
  }

  if (node.request.body.mode !== 'none') {
    const text = node.request.body.text[node.request.body.mode as keyof typeof node.request.body.text];
    lines.push(`**Body** (${node.request.body.mode})`, '');
    if (text?.trim()) lines.push('```', text.trim(), '```', '');
  }

  if (node.request.examples?.length) {
    lines.push('**Example responses**', '', ...node.request.examples.map((ex) => `- *${ex.name}* — \`${ex.status}\``), '');
  }

  return lines;
}

function renderNode(node: TreeNode, depth: number, lines: string[]) {
  const heading = '#'.repeat(Math.min(depth + 2, 6));
  if (node.type === 'folder') {
    lines.push(`${heading} ${node.name}`, '');
    for (const child of node.items) renderNode(child, depth + 1, lines);
    return;
  }
  if (node.type === 'websocket') {
    lines.push(`${heading} ${node.name} (WebSocket)`, '', `\`${node.request.url}\``, '');
    return;
  }
  if (node.type === 'grpc') {
    const target = node.request.service && node.request.method ? `${node.request.service}/${node.request.method}` : 'no method chosen';
    lines.push(`${heading} ${node.name} (gRPC)`, '', `\`${node.request.url}\` · \`${target}\``, '');
    return;
  }
  lines.push(...requestLines(node, heading));
}

/** Renders a collection as a single markdown document — every folder, request and their docs, headers, params and body. */
export function renderCollectionDocs(collection: Collection): string {
  const lines: string[] = [`# ${collection.name}`, ''];
  if (collection.description?.trim()) lines.push(collection.description.trim(), '');
  for (const node of collection.items) renderNode(node, 0, lines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
