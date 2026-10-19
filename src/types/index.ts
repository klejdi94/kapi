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
  /** Variable rows only: masks the value in the UI and keeps it out of what's sent to the AI. */
  secret?: boolean;
  /** Persisted form only: the value lives in the encrypted secrets file (see lib/secretVault.ts), not here. */
  secretInVault?: boolean;
}

export type AuthType =
  | 'none'
  | 'inherit'
  | 'bearer'
  | 'basic'
  | 'apikey'
  | 'jwt'
  | 'oauth2'
  | 'awsv4'
  | 'digest'
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
  /** AWS Signature Version 4 — signed locally over the final request, right before it's sent. */
  awsv4?: { accessKey: string; secretKey: string; sessionToken: string; region: string; service: string };
  /** HTTP Digest (RFC 7616) — answered automatically when the server replies 401 with a Digest challenge. */
  digest?: { username: string; password: string };
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
  /** `id` keys the in-memory file store (see `lib/files.ts`) — per-request so two tabs with a binary body never share bytes. Optional only for data saved before this field existed. */
  binary: { fileName: string; id?: string } | null;
}

export interface RequestSettings {
  followRedirects: boolean;
  timeoutMs: number;
  /** Turn off kapi's automatic Content-Type / Accept headers. */
  autoHeaders: boolean;
  /** `http://` or `socks5://` proxy for this request; empty/unset means none. */
  proxyUrl?: string;
  /** Skips certificate chain/hostname validation — for a self-signed or internal CA without importing it. */
  insecureSkipTlsVerify?: boolean;
  /** PEM-encoded client certificate, its private key, and (optionally) a custom CA bundle — mutual TLS. Setting cert+key routes this request through a dedicated client instead of kapi's normal path; multipart form-data bodies aren't supported over it yet. */
  clientCertPem?: string;
  clientKeyPem?: string;
  caCertPem?: string;
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
  /** JS run before the request is built — set/read variables, e.g. to sign a request. */
  preRequestScript?: string;
  /** JS run after the response arrives — assertions via pm.test(), can also set variables. */
  testScript?: string;
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
  pinned?: boolean;
  /** Markdown notes shown in the Docs tab and included in exported collection docs. */
  description?: string;
}

/** A saved WebSocket connection — deliberately much simpler than RequestDef: no body modes, no methods. */
export interface WebSocketRequestDef {
  url: string;
  headers: KV[];
  /** Sec-WebSocket-Protocol values offered at handshake time. */
  protocols: string[];
  /** Text sent by default when the "send" box is empty and the user just wants a quick ping. */
  defaultMessage: string;
}

export interface WebSocketNode {
  id: string;
  type: 'websocket';
  name: string;
  request: WebSocketRequestDef;
  pinned?: boolean;
}

export interface GrpcMethodInfo {
  name: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputType: string;
  outputType: string;
  /** JSON skeleton of the input message, generated from the schema. */
  inputTemplate: string;
}

export interface GrpcServiceInfo {
  /** Fully qualified, e.g. `helloworld.Greeter`. */
  name: string;
  methods: GrpcMethodInfo[];
}

export interface GrpcRequestDef {
  /** `host:port`, or with `http://` (plaintext) / `https://` (TLS). */
  url: string;
  schemaSource: 'reflection' | 'proto';
  /** The .proto files the schema was compiled from, when `schemaSource` is `proto`. */
  protoPaths: string[];
  /** Base64 FileDescriptorSet — the compiled schema, kept so a saved request works without the files. */
  descriptorSet: string;
  services: GrpcServiceInfo[];
  service: string;
  method: string;
  /** Protobuf JSON. For client-streaming and bidi methods, a JSON array of messages sent in order. */
  message: string;
  metadata: KV[];
  timeoutMs: number;
  caCertPem?: string;
  clientCertPem?: string;
  clientKeyPem?: string;
}

export interface GrpcNode {
  id: string;
  type: 'grpc';
  name: string;
  request: GrpcRequestDef;
  pinned?: boolean;
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

export type TreeNode = RequestNode | WebSocketNode | GrpcNode | FolderNode;

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
  /** Runs before every request in the collection, ahead of that request's own pre-request script. */
  preRequestScript?: string;
  /** Runs after every response in the collection, ahead of that request's own test script. */
  testScript?: string;
}

export interface Environment {
  id: string;
  name: string;
  variables: KV[];
}

export interface MockHeader {
  key: string;
  value: string;
}

export interface MockRoute {
  id: string;
  enabled: boolean;
  method: string;
  /** `/users/:id` — `:segments` match any single path segment. */
  path: string;
  status: number;
  headers: MockHeader[];
  body: string;
  delayMs: number;
}

export interface MockServerConfig {
  /** 0 asks the OS for any free port. */
  port: number;
  routes: MockRoute[];
}

/** A cookie captured from a `Set-Cookie` response header, carried into later requests to matching hosts. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Epoch ms; null means a session cookie (no Expires/Max-Age given). */
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
  setAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  /** A single emoji, or empty for the default first-letter avatar. */
  icon: string;
  collections: Collection[];
  environments: Environment[];
  globals: KV[];
  activeEnvironmentId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Absolute path to a local folder this workspace is synced to as a git repo. */
  gitRepoPath: string | null;
  mockServer: MockServerConfig;
  /** Cookies picked up from responses, sent back automatically to matching hosts — like a browser's jar. */
  cookies: StoredCookie[];
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
  kind: 'http' | 'ws' | 'grpc' | 'collection' | 'folder';
  request: RequestDef;
  /** Only set when `kind === 'ws'`. */
  ws: WebSocketRequestDef | null;
  /** Only set when `kind === 'grpc'`. */
  grpc?: GrpcRequestDef | null;
  dirty: boolean;
  /** Pinned tabs sort first and survive "Close other tabs" / "Close all tabs". */
  pinned?: boolean;
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

/** One request's outcome within a saved collection run — no live response, just enough to spot a regression later. */
export interface RunHistoryResult {
  iteration: number;
  name: string;
  path: string[];
  method: string;
  url: string;
  status: 'passed' | 'failed' | 'error';
  httpStatus: number | null;
  durationMs: number;
  errorMessage: string | null;
  testsPassed: number;
  testsTotal: number;
}

/** One full "Run collection" execution, saved so past runs of the same collection can be compared over time. */
export interface RunHistoryEntry {
  id: string;
  collectionId: string;
  collectionName: string;
  /** The folder name when the run was scoped to one, else null for the whole collection. */
  scopeName: string | null;
  at: number;
  iterations: number;
  durationMs: number;
  passed: number;
  failed: number;
  errored: number;
  results: RunHistoryResult[];
}

/** One "sync this collection with a backend's OpenAPI spec" — kept so the history of what a backend's API surface looked like over time is visible, the same spirit as `RunHistoryEntry` for test runs. */
export interface OpenApiHistoryEntry {
  id: string;
  collectionId: string;
  collectionName: string;
  at: number;
  /** Where the spec came from — a URL or a local file path, for display only. */
  source: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export type ResponseView = 'pretty' | 'tree' | 'raw' | 'preview' | 'headers' | 'cookies' | 'timings' | 'tests' | 'stream' | 'table' | 'chart';
export type RequestTabKey = 'params' | 'body' | 'headers' | 'auth' | 'scripts' | 'docs' | 'settings';
