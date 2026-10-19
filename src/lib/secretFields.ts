import type { AuthConfig, Collection, KV, MqttRequestDef, TreeNode } from '@/types';

/**
 * Where secrets live in kapi's data, in one place: secret-flagged variable
 * rows, and the credential fields of every auth config (collection, folder,
 * request). Used to keep them encrypted at rest (secretVault.ts) and out of
 * git snapshots (gitWorkspace.ts).
 */

/** The fields of an auth config that hold credentials, as `section.field`. */
export const AUTH_SECRET_FIELDS = [
  'bearer.token',
  'basic.password',
  'apikey.value',
  'jwt.secret',
  'oauth2.accessToken',
  'oauth2.refreshToken',
  'oauth2.clientSecret',
  'oauth2.password',
  'awsv4.secretKey',
  'awsv4.sessionToken',
  'digest.password',
  'custom.value',
] as const;

export type AuthSecretField = (typeof AUTH_SECRET_FIELDS)[number];

/** `{{token}}` on its own is a reference to a variable, not a secret — the variable is where the secret is. */
export function isVariableReference(value: string): boolean {
  return /^\s*\{\{[^{}]+\}\}\s*$/.test(value);
}

export function getAuthField(auth: AuthConfig, field: AuthSecretField): string {
  const [section, key] = field.split('.') as [keyof AuthConfig, string];
  const holder = auth[section] as Record<string, unknown> | undefined;
  const value = holder?.[key];
  return typeof value === 'string' ? value : '';
}

export function setAuthField(auth: AuthConfig, field: AuthSecretField, value: string): void {
  const [section, key] = field.split('.') as [keyof AuthConfig, string];
  const holder = auth[section] as Record<string, unknown> | undefined;
  if (holder && typeof holder === 'object') holder[key] = value;
}

/** A literal credential worth protecting: non-empty and not just a `{{variable}}`. */
export function isLiteralSecret(value: string): boolean {
  return !!value && !isVariableReference(value);
}

/** Every MQTT connection in a collection (their passwords are secrets too). */
export function collectionMqtt(collection: Collection): { ownerId: string; request: MqttRequestDef }[] {
  const out: { ownerId: string; request: MqttRequestDef }[] = [];
  const visit = (items: TreeNode[]) => {
    for (const node of items ?? []) {
      if (node.type === 'folder') visit(node.items);
      else if (node.type === 'mqtt' && node.request) out.push({ ownerId: node.id, request: node.request });
    }
  };
  visit(collection.items);
  return out;
}

/** Every auth config in a collection, keyed by the id of whatever owns it. */
export function collectionAuths(collection: Collection): { ownerId: string; auth: AuthConfig }[] {
  const out: { ownerId: string; auth: AuthConfig }[] = [];
  if (collection.auth) out.push({ ownerId: collection.id, auth: collection.auth });
  const visit = (items: TreeNode[]) => {
    for (const node of items ?? []) {
      if (node.type === 'folder') {
        if (node.auth) out.push({ ownerId: node.id, auth: node.auth });
        visit(node.items);
      } else if (node.type === 'request' && node.request?.auth) {
        out.push({ ownerId: node.id, auth: node.request.auth });
      }
    }
  };
  visit(collection.items);
  return out;
}

/**
 * A copy of the collections that is safe to commit: secret-flagged collection
 * variables and literal auth credentials are blanked. `{{variable}}`
 * references are kept — they carry no secret and keep the requests working
 * for whoever pulls them.
 */
export function redactCollections(collections: Collection[]): Collection[] {
  const copy = structuredClone(collections) as Collection[];
  for (const collection of copy) {
    collection.variables = (collection.variables ?? []).map((row: KV) => (row.secret && !isVariableReference(row.value) ? { ...row, value: '' } : row));
    for (const { auth } of collectionAuths(collection)) {
      for (const field of AUTH_SECRET_FIELDS) {
        if (isLiteralSecret(getAuthField(auth, field))) setAuthField(auth, field, '');
      }
    }
    for (const { request } of collectionMqtt(collection)) {
      if (isLiteralSecret(request.password)) request.password = '';
    }
  }
  return copy;
}

/**
 * Applying a pulled snapshot (which has its secrets blanked) over the
 * collections already here: wherever the snapshot has an empty secret and the
 * local copy of the same collection/folder/request has one, keep the local
 * value. A pull never wipes credentials that were only ever on this machine.
 */
export function keepLocalSecrets(incoming: Collection[], local: Collection[]): Collection[] {
  const result = structuredClone(incoming) as Collection[];
  const localAuths = new Map<string, AuthConfig>();
  const localMqtt = new Map<string, MqttRequestDef>();
  const localVars = new Map<string, KV>();
  for (const collection of local) {
    for (const { ownerId, auth } of collectionAuths(collection)) localAuths.set(ownerId, auth);
    for (const { ownerId, request } of collectionMqtt(collection)) localMqtt.set(ownerId, request);
    for (const row of collection.variables ?? []) localVars.set(`${collection.id}\u0000${row.key}`, row);
  }
  for (const collection of result) {
    collection.variables = (collection.variables ?? []).map((row) => {
      const mine = localVars.get(`${collection.id}\u0000${row.key}`);
      return row.secret && !row.value && mine?.value ? { ...row, value: mine.value } : row;
    });
    for (const { ownerId, auth } of collectionAuths(collection)) {
      const mine = localAuths.get(ownerId);
      if (!mine) continue;
      for (const field of AUTH_SECRET_FIELDS) {
        if (!getAuthField(auth, field) && isLiteralSecret(getAuthField(mine, field))) setAuthField(auth, field, getAuthField(mine, field));
      }
    }
  }
  for (const collection of result) {
    for (const { ownerId, request } of collectionMqtt(collection)) {
      const mine = localMqtt.get(ownerId);
      if (!request.password && mine && isLiteralSecret(mine.password)) request.password = mine.password;
    }
  }
  return result;
}
