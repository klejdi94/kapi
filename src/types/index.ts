/** The complete kapi data model. Everything here is persisted to localStorage. */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number] | (string & {});

/** One row of a key/value grid (params, headers, form fields, variables). */
export interface KV {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  /** form-data rows only: a text field or a file picker. */
  kind?: 'text' | 'file';
  /** form-data file rows: name kept for display; the File itself cannot be persisted. */
  fileName?: string;
  /** Marks a header kapi generated (Content-Type, Host…) rather than the user. */
  auto?: boolean;
}

export type AuthType =
  | 'none'
  | 'inherit'
  | 'bearer'
  | 'basic'
  | 'apikey'
  | 'jwt'
  | 'oauth2'
  | 'custom';

export interface AuthConfig {
  type: AuthType;
  bearer?: { token: string };
  basic?: { username: string; password: string };
  apikey?: { key: string; value: string; in: 'header' | 'query' };
  jwt?: {
    algorithm: 'HS256' | 'HS384' | 'HS512';
    secret: string;
    secretIsBase64: boolean;
    payload: string;
    headerPrefix: string;
    addTo: 'header' | 'query';
    queryKey: string;
  };
  oauth2?: {
    /** Pasted token, or one obtained through the built-in flows. */
    accessToken: string;
    headerPrefix: string;
    /** Fields used by the token-fetching flows. */
    grantType: 'authorization_code_pkce' | 'client_credentials' | 'password' | 'implicit';
    authUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
    audience: string;
    username: string;
    password: string;
    redirectUri: string;
    clientAuth: 'body' | 'basic';
    expiresAt?: number;
    refreshToken?: string;
  };
  custom?: { header: string; value: string };
}

export type BodyMode =
  | 'none'
  | 'json'
  | 'xml'
  | 'html'
  | 'text'
  | 'javascript'
  | 'graphql'
  | 'form-data'
  | 'urlencoded'
  | 'binary';

export interface BodyConfig {
  mode: BodyMode;
  /** Shared by every text-ish mode; kept per mode so switching doesn't lose work. */
  text: Partial<Record<'json' | 'xml' | 'html' | 'text' | 'javascript', string>>;
  graphql: { query: string; variables: string };
  formData: KV[];
  urlencoded: KV[];
  binary: { fileName: string } | null;
}

export interface RequestSettings {
  followRedirects: boolean;
  timeoutMs: number;
  /** Turn off kapi's automatic Content-Type / Accept headers. */
  autoHeaders: boolean;
}

export interface RequestDef {
  method: HttpMethod;
  url: string;
  params: KV[];
  pathVars: KV[];
  headers: KV[];
  auth: AuthConfig;
  body: BodyConfig;
  settings: RequestSettings;
  /** Saved sample responses, shown in the viewer's examples menu. */
  examples?: SavedExample[];
}

export interface SavedExample {
  id: string;
  name: string;
  status: number;
  headers: [string, string][];
  body: string;
  savedAt: number;
}

export interface RequestNode {
  id: string;
  type: 'request';
  name: string;
  request: RequestDef;
}

export interface FolderNode {
  id: string;
  type: 'folder';
  name: string;
  expanded: boolean;
  auth: AuthConfig;
  headers: KV[];
  items: TreeNode[];
}

export type TreeNode = RequestNode | FolderNode;

export interface Collection {
  id: string;
  name: string;
  description: string;
  expanded: boolean;
  /** Defaults every request inside inherits unless it overrides them. */
  auth: AuthConfig;
  headers: KV[];
  variables: KV[];
  items: TreeNode[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KV[];
}

export interface Workspace {
  id: string;
  name: string;
  collections: Collection[];
  environments: Environment[];
  globals: KV[];
  activeEnvironmentId: string | null;
  createdAt: number;
  updatedAt: number;
}

/* ---------------------------------------------------------------- responses */

export interface ResponseTimings {
  /** Time to first byte, measured client-side. */
  ttfb: number;
  /** Wall-clock total including body download. */
  total: number;
}

export interface ResponseSize {
  headers: number;
  body: number;
}

export interface KapiResponse {
  id: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  /** Decoded text when the body is textual; empty for binary payloads. */
  text: string;
  /** Live bytes, kept in memory only — never persisted. */
  blob: Blob | null;
  contentType: string;
  size: ResponseSize;
  timings: ResponseTimings;
  finalUrl: string;
  redirected: boolean;
  /** True when the body isn't decodable text (image, pdf, archive…). */
  binary: boolean;
  receivedAt: number;
  /** The request as it was actually sent, for the code generator and HAR export. */
  sent: SentRequest;
}

export interface SentRequest {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  bodyText: string | null;
  bodyKind: BodyMode;
}

export type KapiErrorKind =
  | 'dns'
  | 'refused'
  | 'tls'
  | 'timeout'
  | 'aborted'
  | 'blocked'
  | 'invalid'
  | 'unknown';

export interface KapiError {
  kind: KapiErrorKind;
  title: string;
  detail: string;
  elapsed: number;
}

export type RunResult = { ok: true; response: KapiResponse } | { ok: false; error: KapiError };

/* ------------------------------------------------------------- ui/session */

/** An open editor tab. Draft requests live entirely in the tab. */
export interface Tab {
  id: string;
  /** Set when the tab is backed by a saved request. */
  nodeId: string | null;
  collectionId: string | null;
  name: string;
  request: RequestDef;
  dirty: boolean;
}

export interface HistoryEntry {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number | null;
  errorKind: KapiErrorKind | null;
  duration: number;
  size: number;
  at: number;
  request: RequestDef;
}

export type ResponseView = 'pretty' | 'tree' | 'raw' | 'preview' | 'headers' | 'cookies' | 'timings';
export type RequestTabKey = 'params' | 'body' | 'headers' | 'auth' | 'settings';
