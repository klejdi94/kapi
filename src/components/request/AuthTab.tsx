import type { AuthConfig, AuthType } from '@/types';
import { AUTH_LABELS } from '@/lib/auth';
import { Field, Select, Checkbox, Badge } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';

const TYPES: AuthType[] = ['inherit', 'none', 'bearer', 'basic', 'apikey', 'jwt', 'oauth2', 'custom'];

export function AuthTab({
  auth,
  onChange,
  inheritedFrom,
  warning,
  canInherit,
}: {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
  inheritedFrom: string | null;
  warning: string | null;
  canInherit: boolean;
}) {
  const set = <K extends keyof AuthConfig>(key: K, value: AuthConfig[K]) => onChange({ ...auth, [key]: value });

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
            <p className="max-w-lg text-[11px] leading-relaxed text-faint">
              Token requests go out the same way as any other request in kapi — nothing about this exchange is
              stored; the token lives only in this request until you close the tab.
            </p>
          </div>
        )}

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
