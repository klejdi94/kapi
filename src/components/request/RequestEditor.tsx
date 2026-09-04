import { useMemo } from 'react';
import type { Collection, RequestDef, RequestTabKey } from '@/types';
import { Segmented } from '@/components/ui/primitives';
import { UrlBar } from './UrlBar';
import { ParamsTab } from './ParamsTab';
import { HeadersTab } from './HeadersTab';
import { AuthTab } from './AuthTab';
import { BodyTab } from './BodyTab';
import { SettingsTab } from './SettingsTab';
import { ScriptsTab } from './ScriptsTab';
import { kv, withTrailingBlank } from '@/lib/factory';
import { mergeParamsFromUrl, pathVariableNames, unresolvedVariables } from '@/lib/send';
import { AUTH_LABELS, effectiveAuth } from '@/lib/auth';
import { ancestorsOf } from '@/lib/tree';
import { buildBody } from '@/lib/body';
import { buildScope, resolve as resolveVar } from '@/lib/variables';
import { useSession } from '@/store/session';
import { useActiveWorkspace } from '@/store/workspaces';
import { parseCurl } from '@/lib/importers/curl';
import { toast } from '@/lib/toast';

export function RequestEditor({
  request,
  onChange,
  onSend,
  onCancel,
  onSave,
  onImportCurl,
  onGenerateCode,
  loading,
  dirty,
  collection,
  nodeId,
}: {
  tabId: string;
  nodeId: string | null;
  request: RequestDef;
  onChange: (request: RequestDef) => void;
  onSend: () => void;
  onCancel: () => void;
  onSave: () => void;
  onImportCurl: (request: RequestDef) => void;
  onGenerateCode: () => void;
  loading: boolean;
  dirty: boolean;
  collection: Collection | null;
}) {
  const requestTab = useSession((s) => s.requestTab);
  const setRequestTab = useSession((s) => s.set);
  const workspace = useActiveWorkspace();

  const scope = useMemo(() => buildScope(workspace, collection), [workspace, collection]);
  const resolve = (text: string) => resolveVar(text, scope);

  const folderChain = collection && nodeId ? ancestorsOf(collection.items, nodeId) : [];
  const authChain = [collection?.auth, ...folderChain.map((f) => f.auth), request.auth];
  const { auth: resolvedAuth, inheritedFrom } = effectiveAuth(authChain);
  const inheritedFromLabel =
    inheritedFrom === -1 || inheritedFrom === authChain.length - 1
      ? null
      : inheritedFrom === 0
        ? `collection "${collection?.name}"`
        : `folder "${folderChain[inheritedFrom - 1]?.name}"`;

  const detectedPathVars = pathVariableNames(request.url);
  const pathVarRows = detectedPathVars.map(
    (name) => request.pathVars.find((r) => r.key === name) ?? kv({ key: name, value: '' }),
  );

  const builtBody = buildBody(request, scope);
  const autoHeaderPreview = request.settings.autoHeaders
    ? [
        ...(builtBody.contentType ? [{ key: 'Content-Type', value: builtBody.contentType }] : []),
        { key: 'Accept', value: '*/*' },
      ].filter((h) => !request.headers.some((r) => r.enabled && r.key.toLowerCase() === h.key.toLowerCase()))
    : [];

  const invalidVars = unresolvedVariables(request, scope);
  const enabledHeaderCount = request.headers.filter((r) => r.enabled && r.key.trim()).length;
  const enabledParamCount = request.params.filter((r) => r.enabled && r.key.trim()).length;
  const hasBody = request.body.mode !== 'none';
  const hasScripts = !!(request.preRequestScript?.trim() || request.testScript?.trim());

  const set = <K extends keyof RequestDef>(key: K, value: RequestDef[K]) => onChange({ ...request, [key]: value });

  const onUrlChange = (url: string) => {
    // A pasted or typed `?query=string` gets mirrored into the params grid,
    // same as :pathVars already are — nothing about the URL stays invisible.
    const mergedParams = mergeParamsFromUrl(url, request.params);
    onChange({ ...request, url, ...(mergedParams ? { params: withTrailingBlank(mergedParams) } : {}) });
  };

  const tryImportCurl = (text: string): boolean => {
    const parsed = parseCurl(text);
    if (!parsed) return false;
    onImportCurl(parsed);
    toast.success('Imported from cURL', `${parsed.method} ${parsed.url}`);
    return true;
  };

  return (
    <div className="flex h-full flex-col">
      <UrlBar
        method={request.method}
        url={request.url}
        onMethod={(method) => set('method', method)}
        onUrl={onUrlChange}
        onSend={onSend}
        onCancel={onCancel}
        onSave={onSave}
        onImportCurl={tryImportCurl}
        onGenerateCode={onGenerateCode}
        loading={loading}
        dirty={dirty}
        invalidVars={invalidVars}
      />

      <div className="flex items-center justify-between border-b border-line px-3">
        <Segmented
          value={requestTab}
          onChange={(v) => setRequestTab('requestTab', v as RequestTabKey)}
          options={[
            { value: 'params', label: 'Params', count: enabledParamCount },
            { value: 'body', label: 'Body', dot: hasBody },
            { value: 'headers', label: 'Headers', count: enabledHeaderCount },
            { value: 'auth', label: 'Auth', dot: resolvedAuth.type !== 'none' },
            { value: 'scripts', label: 'Scripts', dot: hasScripts },
            { value: 'settings', label: 'Settings' },
          ]}
        />
        {requestTab === 'auth' && resolvedAuth.type !== 'none' && (
          <span className="text-[11px] text-faint">{AUTH_LABELS[resolvedAuth.type]}</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {requestTab === 'params' && (
          <ParamsTab
            params={request.params}
            pathVars={pathVarRows}
            onParams={(params) => set('params', params)}
            onPathVars={(pathVars) => set('pathVars', withTrailingBlank(pathVars).slice(0, -1))}
            resolve={resolve}
          />
        )}
        {requestTab === 'body' && (
          <BodyTab
            body={request.body}
            onChange={(body) => set('body', body)}
            resolve={resolve}
            disabledReason={request.method === 'GET' || request.method === 'HEAD' ? `${request.method} requests are sent without a body.` : null}
          />
        )}
        {requestTab === 'headers' && (
          <HeadersTab headers={request.headers} autoHeaders={autoHeaderPreview} onChange={(headers) => set('headers', headers)} resolve={resolve} />
        )}
        {requestTab === 'auth' && (
          <AuthTab
            auth={request.auth}
            onChange={(auth) => set('auth', auth)}
            inheritedFrom={inheritedFromLabel}
            warning={null}
            canInherit={!!collection}
          />
        )}
        {requestTab === 'scripts' && (
          <ScriptsTab
            preRequestScript={request.preRequestScript ?? ''}
            testScript={request.testScript ?? ''}
            onChange={(patch) => onChange({ ...request, ...patch })}
            collectionHasScripts={{
              pre: !!collection?.preRequestScript?.trim(),
              test: !!collection?.testScript?.trim(),
            }}
          />
        )}
        {requestTab === 'settings' && <SettingsTab settings={request.settings} onChange={(settings) => set('settings', settings)} />}
      </div>
    </div>
  );
}
