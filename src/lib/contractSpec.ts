import type { ResponseContract } from '@/types';

/**
 * Reading response contracts out of an OpenAPI/Swagger document — kept apart
 * from the validator (contract.ts) so importing a spec doesn't pull Ajv into
 * the app's main bundle.
 */

type Json = Record<string, unknown>;

/** Inlines `$ref`s (`#/components/schemas/X`, `#/definitions/X`). Cycles and very deep nesting become `{}` (accept anything). */
export function derefSchema(schema: unknown, doc: unknown, chain: string[] = [], depth = 0): unknown {
  if (Array.isArray(schema)) return schema.map((item) => derefSchema(item, doc, chain, depth + 1));
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Json;
  if (typeof s.$ref === 'string') {
    const ref = s.$ref;
    if (!ref.startsWith('#/') || chain.includes(ref) || depth > 24) return {};
    let target: unknown = doc;
    for (const part of ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      target = target && typeof target === 'object' ? (target as Json)[key] : undefined;
    }
    if (target === undefined) return {};
    return derefSchema(target, doc, [...chain, ref], depth + 1);
  }
  const out: Json = {};
  for (const [key, value] of Object.entries(s)) out[key] = derefSchema(value, doc, chain, depth + 1);
  return out;
}

export function isJsonContentType(type: string): boolean {
  const mime = type.split(';')[0].trim().toLowerCase();
  return mime === 'application/json' || mime.endsWith('+json') || mime === '*/*';
}

interface OaResponse {
  description?: string;
  content?: Record<string, { schema?: unknown }>;
  schema?: unknown;
  $ref?: string;
}

/** The response contract for one operation of a spec, or null when it documents no responses. */
export function contractFromOperation(op: { responses?: Record<string, OaResponse> }, doc: { openapi?: string; swagger?: string }): ResponseContract | null {
  if (!op.responses || typeof op.responses !== 'object') return null;
  const specVersion: ResponseContract['specVersion'] = doc.swagger ? '2.0' : String(doc.openapi ?? '').startsWith('3.1') ? '3.1' : '3.0';
  const responses: ResponseContract['responses'] = {};
  for (const [status, raw] of Object.entries(op.responses)) {
    const response = derefSchema(raw, doc) as OaResponse;
    let schema: unknown;
    if (specVersion === '2.0') {
      schema = response.schema;
    } else {
      const jsonType = Object.keys(response.content ?? {}).find(isJsonContentType);
      schema = jsonType ? response.content?.[jsonType]?.schema : undefined;
    }
    responses[status.toUpperCase()] = { description: response.description ?? '', ...(schema && typeof schema === 'object' ? { schema } : {}) };
  }
  return Object.keys(responses).length ? { specVersion, enabled: true, responses } : null;
}

