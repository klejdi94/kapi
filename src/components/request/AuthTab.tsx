import { useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, ScanSearch, X } from 'lucide-react';
import type { AuthConfig, AuthType } from '@/types';
import { AUTH_LABELS } from '@/lib/auth';
import { Field, Select, Checkbox, Badge, Button } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';
import { useTokenInspector } from '@/store/tokenInspector';
import { fetchOAuthToken, refreshOAuthToken, cancelAuthorizationCode, OAUTH_REDIRECT_URI } from '@/lib/oauth2';
import type { VarScope } from '@/lib/variables';
import { toast } from '@/lib/toast';
import { emptyAuth } from '@/lib/factory';

function InspectLink({ value }: { value: string }) {
  if (!value.trim()) return null;
  return (
    <button
      type="button"
      onClick={() => useTokenInspector.getState().openWith(value)}
      className="mt-1 flex items-center gap-1 text-[11px] text-faint hover:text-dim"
    >
      <ScanSearch size={11} /> Inspect
    </button>
  );
}

const TYPES: AuthType[] = ['inherit', 'none', 'bearer', 'basic', 'apikey', 'jwt', 'oauth2', 'awsv4', 'digest', 'custom'];

const INPUT = 'h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none';

export function AuthTab({
  auth,
  onChange,
  inheritedFrom,
  warning,
  canInherit,
  scope,
}: {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  inheritedFrom: string | null;
  warning: string | null;
  canInherit: boolean;
  /** Needed only to resolve {{variables}} when actually fetching an OAuth 2.0 token. */
  scope?: VarScope;
}) {
  const set = <K extends keyof AuthConfig>(key: K, value: AuthConfig[K]) => onChange({ ...auth, [key]: value });

  const [tokenState, setTokenState] = useState<'idle' | 'waiting' | 'loading' | 'error'>('idle');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [redirectCopied, setRedirectCopied] = useState(false);

  const getToken = async () => {
    if (!auth.oauth2 || !scope) return;
    setTokenState('loading');
    setTokenError(null);
    try {
      const result = await fetchOAuthToken(auth.oauth2, scope, () => setTokenState('waiting'));
      set('oauth2', { ...auth.oauth2, accessToken: result.accessToken, expiresAt: result.expiresAt ?? undefined, refreshToken: result.refreshToken ?? auth.oauth2.refreshToken });
      setTokenState('idle');
      toast.success('Token acquired', result.expiresAt ? `Expires ${new Date(result.expiresAt).toLocaleString()}` : 'No expiry given');
    } catch (err) {
      setTokenState('error');
      setTokenError((err as Error).message);
    }
  };

  const doRefresh = async () => {
    if (!auth.oauth2 || !scope) return;
    setTokenState('loading');
    setTokenError(null);
    try {
      const result = await refreshOAuthToken(auth.oauth2, scope);
      set('oauth2', { ...auth.oauth2, accessToken: result.accessToken, expiresAt: result.expiresAt ?? undefined, refreshToken: result.refreshToken ?? auth.oauth2.refreshToken });
      setTokenState('idle');
      toast.success('Token refreshed');
    } catch (err) {
      setTokenState('error');
      setTokenError((err as Error).message);
    }
  };

  const cancelWaiting = async () => {
    await cancelAuthorizationCode();
    setTokenState('idle');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line p-3">
        <Field label="Type" className="w-56">
          <Select value={auth.type} onChange={(e) => set('type', e.target.value as AuthType)}>
            {TYPES.filter((t) => canInherit || t !== 'inherit').map((t) => (
              <option key={t} value={t}>
                {AUTH_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {auth.type === 'inherit' && inheritedFrom && (
          <Badge tone="info" className="mt-4">
            Using auth from {inheritedFrom}
          </Badge>
        )}
        {warning && (
          <Badge tone="warn" className="mt-4">
            {warning}
          </Badge>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {auth.type === 'none' && (
          <p className="text-[12px] text-faint">This request will not send any authorization.</p>
        )}
        {auth.type === 'inherit' && !inheritedFrom && (
          <p className="text-[12px] text-faint">No parent folder or collection auth is set — nothing will be sent.</p>
        )}

        {auth.type === 'bearer' && (
          <Field label="Token" hint="Sent as an Authorization: Bearer <token> header. {{variables}} are supported.">
            <input
              value={auth.bearer?.token ?? ''}
              onChange={(e) => set('bearer', { token: e.target.value })}
              placeholder="{{token}}"
              className="h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none"
            />
            <InspectLink value={auth.bearer?.token ?? ''} />
          </Field>
        )}

        {auth.type === 'basic' && (
          <div className="grid max-w-sm grid-cols-1 gap-3">
            <Field label="Username">
              <input
                value={auth.basic?.username ?? ''}
                onChange={(e) => set('basic', { ...auth.basic!, username: e.target.value })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={auth.basic?.password ?? ''}
                onChange={(e) => set('basic', { ...auth.basic!, password: e.target.value })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
              />
            </Field>
          </div>
        )}

        {auth.type === 'apikey' && (
          <div className="grid max-w-sm grid-cols-1 gap-3">
            <Field label="Key">
              <input
                value={auth.apikey?.key ?? ''}
                onChange={(e) => set('apikey', { ...auth.apikey!, key: e.target.value })}
                placeholder="X-API-Key"
                className="h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Value">
              <input
                value={auth.apikey?.value ?? ''}
                onChange={(e) => set('apikey', { ...auth.apikey!, value: e.target.value })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="Add to">
              <Select value={auth.apikey?.in ?? 'header'} onChange={(e) => set('apikey', { ...auth.apikey!, in: e.target.value as 'header' | 'query' })}>
                <option value="header">Header</option>
                <option value="query">Query params</option>
              </Select>
            </Field>
          </div>
        )}

        {auth.type === 'jwt' && auth.jwt && (
          <div className="flex flex-col gap-3">
            <div className="grid max-w-sm grid-cols-2 gap-3">
              <Field label="Algorithm">
                <Select value={auth.jwt.algorithm} onChange={(e) => set('jwt', { ...auth.jwt!, algorithm: e.target.value as 'HS256' | 'HS384' | 'HS512' })}>
                  <option value="HS256">HS256</option>
                  <option value="HS384">HS384</option>
                  <option value="HS512">HS512</option>
                </Select>
              </Field>
              <Field label="Add to">
                <Select value={auth.jwt.addTo} onChange={(e) => set('jwt', { ...auth.jwt!, addTo: e.target.value as 'header' | 'query' })}>
                  <option value="header">Header</option>
                  <option value="query">Query param</option>
                </Select>
              </Field>
            </div>
            <Field label="Secret" hint="HMAC signing key. Signed entirely in your browser via WebCrypto — never sent anywhere.">
              <input
                value={auth.jwt.secret}
                onChange={(e) => set('jwt', { ...auth.jwt!, secret: e.target.value })}
                className="h-8 max-w-sm rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none"
              />
            </Field>
            <Checkbox
              label="Secret is base64-encoded"
              checked={auth.jwt.secretIsBase64}
              onChange={(v) => set('jwt', { ...auth.jwt!, secretIsBase64: v })}
            />
            <Field label="Payload (JSON)">
              <div className="h-40 overflow-hidden rounded-md border border-line bg-surface">
                <CodeEditor value={auth.jwt.payload} onChange={(v) => set('jwt', { ...auth.jwt!, payload: v })} language="json" />
              </div>
            </Field>
          </div>
        )}

        {auth.type === 'oauth2' && auth.oauth2 && (
          <div className="flex flex-col gap-3">
            <Field label="Access token" hint="Paste a token you already have, or fill in the fields below and request one.">
              <input
                value={auth.oauth2.accessToken}
                onChange={(e) => set('oauth2', { ...auth.oauth2!, accessToken: e.target.value })}
                className="h-8 max-w-lg rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none"
              />
              <InspectLink value={auth.oauth2.accessToken} />
            </Field>
            <div className="grid max-w-lg grid-cols-2 gap-3">
              <Field label="Grant type">
                <Select
                  value={auth.oauth2.grantType}
                  onChange={(e) => set('oauth2', { ...auth.oauth2!, grantType: e.target.value as typeof auth.oauth2.grantType })}
                >
                  <option value="client_credentials">Client credentials</option>
                  <option value="authorization_code_pkce">Authorization code (PKCE)</option>
                  <option value="password">Password</option>
                  <option value="implicit">Implicit</option>
                </Select>
              </Field>
              <Field label="Header prefix">
                <input
                  value={auth.oauth2.headerPrefix}
                  onChange={(e) => set('oauth2', { ...auth.oauth2!, headerPrefix: e.target.value })}
                  className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
              </Field>
            </div>
            {auth.oauth2.grantType === 'authorization_code_pkce' && (
              <Field label="Redirect URI" hint="Register this exact URI with your OAuth app — kapi always listens on this fixed local port." className="max-w-lg">
                <div className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 font-mono text-[12px] text-dim">
                  <span className="min-w-0 flex-1 truncate">{OAUTH_REDIRECT_URI}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(OAUTH_REDIRECT_URI);
                      setRedirectCopied(true);
                      setTimeout(() => setRedirectCopied(false), 1200);
                    }}
                    className="shrink-0 text-faint hover:text-fg"
                  >
                    {redirectCopied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                  </button>
                </div>
              </Field>
            )}
            <div className="grid max-w-lg grid-cols-2 gap-3">
              {auth.oauth2.grantType !== 'client_credentials' && (
                <Field label="Auth URL">
                  <input value={auth.oauth2.authUrl} onChange={(e) => set('oauth2', { ...auth.oauth2!, authUrl: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
                </Field>
              )}
              <Field label="Token URL">
                <input value={auth.oauth2.tokenUrl} onChange={(e) => set('oauth2', { ...auth.oauth2!, tokenUrl: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
              </Field>
              <Field label="Client ID">
                <input value={auth.oauth2.clientId} onChange={(e) => set('oauth2', { ...auth.oauth2!, clientId: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
              </Field>
              <Field label="Client secret">
                <input type="password" value={auth.oauth2.clientSecret} onChange={(e) => set('oauth2', { ...auth.oauth2!, clientSecret: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
              </Field>
              <Field label="Scope">
                <input value={auth.oauth2.scope} onChange={(e) => set('oauth2', { ...auth.oauth2!, scope: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
              </Field>
              {auth.oauth2.grantType === 'password' && (
                <>
                  <Field label="Username">
                    <input value={auth.oauth2.username} onChange={(e) => set('oauth2', { ...auth.oauth2!, username: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
                  </Field>
                  <Field label="Password">
                    <input type="password" value={auth.oauth2.password} onChange={(e) => set('oauth2', { ...auth.oauth2!, password: e.target.value })} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none" />
                  </Field>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={getToken} disabled={!scope || tokenState === 'loading' || tokenState === 'waiting'}>
                <KeyRound size={13} />
                {tokenState === 'waiting' ? 'Waiting for the browser…' : tokenState === 'loading' ? 'Requesting…' : 'Get new token'}
              </Button>
              {tokenState === 'waiting' && (
                <Button variant="ghost" onClick={cancelWaiting}>
                  <X size={13} /> Cancel
                </Button>
              )}
              {!!auth.oauth2.refreshToken && tokenState === 'idle' && (
                <Button onClick={doRefresh}>
                  <RefreshCw size={13} /> Refresh
                </Button>
              )}
              {!!auth.oauth2.expiresAt && (
                <span className="text-[11px] text-faint">
                  {auth.oauth2.expiresAt < Date.now() ? 'Expired' : `Expires ${new Date(auth.oauth2.expiresAt).toLocaleString()}`}
                </span>
              )}
            </div>
            {tokenError && <p className="max-w-lg text-[11px] text-danger">{tokenError}</p>}
            <p className="max-w-lg text-[11px] leading-relaxed text-faint">
              Token requests go out the same way as any other request in kapi — nothing about this exchange is
              stored; the token lives only in this request until you close the tab.
            </p>
          </div>
        )}

        {auth.type === 'awsv4' && (() => {
          // Requests saved before this auth type existed have no awsv4 block yet.
          const aws = auth.awsv4 ?? emptyAuth().awsv4!;
          const update = (patch: Partial<typeof aws>) => set('awsv4', { ...aws, ...patch });
          return (
            <div className="grid max-w-lg grid-cols-1 gap-3">
              <Field label="Access key ID">
                <input value={aws.accessKey} onChange={(e) => update({ accessKey: e.target.value })} placeholder="{{awsAccessKeyId}}" className={INPUT} />
              </Field>
              <Field label="Secret access key">
                <input type="password" value={aws.secretKey} onChange={(e) => update({ secretKey: e.target.value })} placeholder="{{awsSecretAccessKey}}" className={INPUT} />
              </Field>
              <Field label="Session token" hint="Only for temporary credentials (STS, SSO).">
                <input type="password" value={aws.sessionToken} onChange={(e) => update({ sessionToken: e.target.value })} placeholder="optional" className={INPUT} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Region">
                  <input value={aws.region} onChange={(e) => update({ region: e.target.value })} placeholder="us-east-1" className={INPUT} />
                </Field>
                <Field label="Service" hint="e.g. execute-api, s3, lambda, es">
                  <input value={aws.service} onChange={(e) => update({ service: e.target.value })} placeholder="execute-api" className={INPUT} />
                </Field>
              </div>
              <p className="text-[11px] leading-relaxed text-faint">
                Signed locally with Signature Version 4 over the final URL, headers and body, right before the request is sent —
                the secret key never leaves this machine. Keep the keys in secret variables so they're encrypted at rest.
              </p>
            </div>
          );
        })()}

        {auth.type === 'digest' && (() => {
          const digest = auth.digest ?? emptyAuth().digest!;
          return (
            <div className="grid max-w-sm grid-cols-1 gap-3">
              <Field label="Username">
                <input value={digest.username} onChange={(e) => set('digest', { ...digest, username: e.target.value })} className={INPUT} />
              </Field>
              <Field label="Password">
                <input type="password" value={digest.password} onChange={(e) => set('digest', { ...digest, password: e.target.value })} className={INPUT} />
              </Field>
              <p className="text-[11px] leading-relaxed text-faint">
                The first request goes out without credentials; when the server answers 401 with a Digest challenge, kapi
                answers it (MD5 or SHA-256, qop=auth) and retries once.
              </p>
            </div>
          );
        })()}

        {auth.type === 'custom' && (
          <div className="grid max-w-sm grid-cols-1 gap-3">
            <Field label="Header name">
              <input value={auth.custom?.header ?? ''} onChange={(e) => set('custom', { ...auth.custom!, header: e.target.value })} className="h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
            </Field>
            <Field label="Value">
              <input value={auth.custom?.value ?? ''} onChange={(e) => set('custom', { ...auth.custom!, value: e.target.value })} className="h-8 w-full rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px] focus:border-accent focus:outline-none" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
