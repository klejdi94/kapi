import { useMemo, useState } from 'react';
import { Check, ExternalLink, FileSearch, Radar, Trash2 } from 'lucide-react';
import { Button, EmptyState, Input } from '@/components/ui/primitives';
import { methodVar } from '@/lib/methodColor';
import { useDiscovery } from '@/store/discovery';
import { useWorkspaces } from '@/store/workspaces';
import { buildCollectionFromEndpoints, discoveryAvailable, groupCaptures, openDiscoveryWindow, probeApiSpec, type DiscoveredEndpoint } from '@/lib/discovery';
import { looksLikeOpenApi, parseOpenApiText, importOpenApi } from '@/lib/importers/openapi';
import { toast } from '@/lib/toast';

function normalizeInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function DiscoveryPanel() {
  const url = useDiscovery((s) => s.url);
  const setUrl = useDiscovery((s) => s.setUrl);
  const capturing = useDiscovery((s) => s.capturing);
  const setCapturing = useDiscovery((s) => s.setCapturing);
  const raw = useDiscovery((s) => s.raw);
  const clear = useDiscovery((s) => s.clear);
  const importCollection = useWorkspaces((s) => s.importCollection);
  const importEnvironment = useWorkspaces((s) => s.importEnvironment);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [probing, setProbing] = useState(false);

  const endpoints = useMemo(() => groupCaptures(raw), [raw]);

  if (!discoveryAvailable()) {
    return (
      <EmptyState
        icon={<Radar size={22} />}
        title="Discovery needs the desktop app"
        detail="Opening a browsing window and watching its network traffic isn't possible from a plain browser tab."
      />
    );
  }

  const startCapture = async () => {
    const target = normalizeInput(url);
    if (!target) return;
    try {
      await openDiscoveryWindow(target);
      setCapturing(true);
      clear();
      setSelected(new Set());
    } catch (err) {
      toast.error('Could not open the capture window', (err as Error).message);
    }
  };

  const probe = async () => {
    const target = normalizeInput(url);
    if (!target) return;
    setProbing(true);
    try {
      const origin = new URL(target).origin;
      const found = await probeApiSpec(origin);
      if (!found) {
        toast.info('No spec found', `Checked the usual paths under ${origin} — try browsing instead.`);
        return;
      }
      const data = parseOpenApiText(found.text);
      if (!looksLikeOpenApi(data)) {
        toast.info('Found a file, not a spec', `${found.url} didn't parse as OpenAPI/Swagger.`);
        return;
      }
      const { collection, environment } = importOpenApi(data);
      importCollection(collection);
      if (environment) importEnvironment(environment);
      toast.success('Imported from ' + found.url, `${collection.name} — ${collection.items.length} items`);
    } catch (err) {
      toast.error('Probe failed', (err as Error).message);
    } finally {
      setProbing(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === endpoints.length ? new Set() : new Set(endpoints.map((e) => e.id))));
  };

  const addSelected = () => {
    const chosen = endpoints.filter((e) => selected.has(e.id));
    if (!chosen.length) return;
    const host = chosen[0].host;
    const name = new Set(chosen.map((e) => e.host)).size === 1 ? host : 'Discovered API';
    const { collection, environment } = buildCollectionFromEndpoints(chosen, name);
    importCollection(collection);
    if (environment) importEnvironment(environment);
    toast.success('Added to collection', `${collection.name} — ${chosen.length} endpoint${chosen.length === 1 ? '' : 's'}`);
    setSelected(new Set());
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <p className="text-[11.5px] leading-relaxed text-faint">
          Opens the site in its own window — your real cookies, your real session — and watches the calls it
          makes while you click around. Nothing is sent anywhere outside kapi.
        </p>
        <div className="flex items-center gap-1.5">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="app.example.com" onKeyDown={(e) => e.key === 'Enter' && startCapture()} />
        </div>
        <div className="flex gap-1.5">
          <Button variant="primary" size="sm" onClick={startCapture} disabled={!url.trim()} className="flex-1">
            <ExternalLink size={12} /> Open & capture
          </Button>
          <Button size="sm" onClick={probe} disabled={!url.trim() || probing} className="flex-1">
            <FileSearch size={12} /> {probing ? 'Probing…' : 'Probe for a spec'}
          </Button>
        </div>
        {capturing && (
          <p className="rounded-md bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
            Browse the site in the window that opened — captured calls show up below as they happen.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] text-faint">
          {endpoints.length} endpoint{endpoints.length === 1 ? '' : 's'} · {raw.length} call{raw.length === 1 ? '' : 's'} captured
        </span>
        {endpoints.length > 0 && (
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={toggleAll}>
              {selected.size === endpoints.length ? 'Deselect all' : 'Select all'}
            </Button>
            <Button size="sm" onClick={clear}>
              <Trash2 size={11} />
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {endpoints.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <EmptyState icon={<Radar size={22} />} title="Nothing captured yet" detail="Open a site above and start clicking around — every fetch/XHR call it makes will show up here." />
          </div>
        ) : (
          endpoints.map((ep) => <EndpointRow key={ep.id} endpoint={ep} checked={selected.has(ep.id)} onToggle={() => toggle(ep.id)} />)
        )}
      </div>

      {selected.size > 0 && (
        <div className="border-t border-line p-3">
          <Button variant="primary" onClick={addSelected} className="w-full">
            <Check size={13} /> Add {selected.size} to a collection
          </Button>
        </div>
      )}
    </div>
  );
}

function EndpointRow({ endpoint, checked, onToggle }: { endpoint: DiscoveredEndpoint; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 border-b border-line/60 px-3 py-2 hover:bg-surface-2">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]" />
      <span className="w-12 shrink-0 text-[10px] font-bold uppercase" style={{ color: methodVar(endpoint.method) }}>
        {endpoint.method}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12px] text-fg">{endpoint.path}</div>
        <div className="truncate text-[10.5px] text-faint">{endpoint.host}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[10.5px] text-faint">
        {endpoint.status !== null && <span>{endpoint.status}</span>}
        <span>×{endpoint.hits}</span>
      </div>
    </label>
  );
}
