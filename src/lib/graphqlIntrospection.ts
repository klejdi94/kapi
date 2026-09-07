/** Fetches and summarizes a GraphQL schema via introspection — enough to browse available operations and insert a starter query, not a full client-side schema validator. */
import type { RequestDef } from '@/types';
import type { VarScope } from './variables';
import { send } from './send';
import { emptyBody } from './factory';

const TYPE_REF = `
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
        }
      }
    }
  }
`;

export const INTROSPECTION_QUERY = `query kapiIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: false) {
        name
        description
        args { name type { ${TYPE_REF} } }
        type { ${TYPE_REF} }
      }
    }
  }
}`;

interface RawTypeRef {
  kind: string;
  name: string | null;
  ofType: RawTypeRef | null;
}

interface RawField {
  name: string;
  description: string | null;
  args: { name: string; type: RawTypeRef }[];
  type: RawTypeRef;
}

interface RawType {
  kind: string;
  name: string;
  description: string | null;
  fields: RawField[] | null;
}

interface RawSchema {
  data?: {
    __schema?: {
      queryType?: { name: string } | null;
      mutationType?: { name: string } | null;
      types?: RawType[];
    };
  };
  errors?: { message: string }[];
}

/** Renders a type reference as GraphQL shorthand: `String!`, `[Int]`, `[ID!]!`. */
function typeRefToString(ref: RawTypeRef): string {
  if (ref.kind === 'NON_NULL') return `${typeRefToString(ref.ofType!)}!`;
  if (ref.kind === 'LIST') return `[${typeRefToString(ref.ofType!)}]`;
  return ref.name ?? 'Unknown';
}

/** Strips NON_NULL/LIST wrappers down to the named type, so its own fields can be looked up. */
function namedTypeOf(ref: RawTypeRef): string | null {
  let current: RawTypeRef | null = ref;
  while (current && (current.kind === 'NON_NULL' || current.kind === 'LIST')) current = current.ofType;
  return current?.name ?? null;
}

export interface GraphQLFieldSummary {
  name: string;
  description: string | null;
  args: { name: string; type: string }[];
  returnType: string;
  returnTypeName: string | null;
}

export interface GraphQLSchemaSummary {
  queries: GraphQLFieldSummary[];
  mutations: GraphQLFieldSummary[];
  typesByName: Map<string, RawType>;
}

function toFieldSummary(field: RawField): GraphQLFieldSummary {
  return {
    name: field.name,
    description: field.description,
    args: field.args.map((a) => ({ name: a.name, type: typeRefToString(a.type) })),
    returnType: typeRefToString(field.type),
    returnTypeName: namedTypeOf(field.type),
  };
}

/** Parses a raw introspection response (the JSON body of the query above) into browsable query/mutation lists. */
export function summarizeIntrospection(json: unknown): GraphQLSchemaSummary | null {
  const raw = json as RawSchema;
  const schema = raw.data?.__schema;
  if (!schema?.types) return null;

  const typesByName = new Map<string, RawType>(schema.types.map((t) => [t.name, t]));
  const queryType = schema.queryType?.name ? typesByName.get(schema.queryType.name) : null;
  const mutationType = schema.mutationType?.name ? typesByName.get(schema.mutationType.name) : null;

  return {
    queries: (queryType?.fields ?? []).map(toFieldSummary),
    mutations: (mutationType?.fields ?? []).map(toFieldSummary),
    typesByName,
  };
}

const SCALAR_KINDS = new Set(['SCALAR', 'ENUM']);

/** One level of the return type's own fields, so the skeleton isn't just an empty `{ }` for object-shaped results. */
function selectionFor(typeName: string | null, schema: GraphQLSchemaSummary, indent: string): string {
  const type = typeName ? schema.typesByName.get(typeName) : null;
  if (!type || SCALAR_KINDS.has(type.kind) || !type.fields?.length) return '';
  const picked = type.fields.slice(0, 5).map((f) => `${indent}  ${f.name}`);
  return ` {\n${picked.join('\n')}\n${indent}}`;
}

/** A ready-to-edit starting point: `query {\n  fieldName(arg: "") {\n    id\n    name\n  }\n}`. */
export function buildSkeletonQuery(field: GraphQLFieldSummary, kind: 'query' | 'mutation', schema: GraphQLSchemaSummary): string {
  const args = field.args.length ? `(${field.args.map((a) => `${a.name}: ${placeholderFor(a.type)}`).join(', ')})` : '';
  const selection = selectionFor(field.returnTypeName, schema, '  ') || (SCALAR_KINDS.has(schema.typesByName.get(field.returnTypeName ?? '')?.kind ?? '') ? '' : ' {\n    __typename\n  }');
  return `${kind} {\n  ${field.name}${args}${selection}\n}`;
}

function placeholderFor(type: string): string {
  const base = type.replace(/[![\]]/g, '');
  if (base === 'Int' || base === 'Float') return '0';
  if (base === 'Boolean') return 'true';
  return '""';
}

/**
 * Runs the introspection query against the request's own URL/auth/headers
 * (so an authenticated schema works the same as any other call to it), via
 * the same send pipeline a real send uses — no separate HTTP path to trust.
 */
export async function fetchGraphQLSchema(baseRequest: RequestDef, scope: VarScope): Promise<GraphQLSchemaSummary> {
  const introspectionRequest: RequestDef = {
    ...baseRequest,
    method: 'POST',
    body: { ...emptyBody(), mode: 'json', text: { ...emptyBody().text, json: JSON.stringify({ query: INTROSPECTION_QUERY }) } },
  };

  const result = await send(introspectionRequest, scope);
  if (!result.ok) throw new Error(`${result.error.title} — ${result.error.detail}`);
  if (result.response.binary) throw new Error('The endpoint returned a non-text response.');

  let json: unknown;
  try {
    json = JSON.parse(result.response.text);
  } catch {
    throw new Error("The response wasn't valid JSON — this endpoint may not support introspection.");
  }
  const errors = (json as RawSchema).errors;
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));

  const summary = summarizeIntrospection(json);
  if (!summary) throw new Error("That response didn't look like a GraphQL introspection result.");
  return summary;
}
