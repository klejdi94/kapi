import { useEffect, useState } from 'react';
import { Download, Link as LinkIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Segmented } from '@/components/ui/primitives';
import { useActiveWorkspace } from '@/store/workspaces';
import { useHistory } from '@/store/history';
import { exportPostmanCollection, exportPostmanEnvironment } from '@/lib/exporters/postman';
import { exportHar } from '@/lib/exporters/har';
import { toast } from '@/lib/toast';
import { saveFile } from '@/lib/saveFile';

type Format = 'postman' | 'har' | 'kapi';

const download = (filename: string, content: unknown) =>
  saveFile(filename, JSON.stringify(content, null, 2), 'application/json');

export function ExportModal({ open, onClose, collectionId }: { open: boolean; onClose: () => void; collectionId: string | null }) {
  const workspace = useActiveWorkspace();
  const entries = useHistory((s) => s.entries);
  const [format, setFormat] = useState<Format>('postman');

  const collection = collectionId ? workspace.collections.find((c) => c.id === collectionId) : null;

  useEffect(() => {
    if (open) setFormat('postman');
  }, [open]);

  if (!collection && collectionId) return null;

  const doExport = async () => {
    if (collection) {
      const saved =
        format === 'postman'
          ? await download(`${collection.name}.postman_collection.json`, exportPostmanCollection(collection))
          : format === 'kapi'
            ? await download(`${collection.name}.kapi.json`, collection)
            : await download('history.har', exportHar(entries.slice(0, 500).map((request) => ({ request }))));
      if (saved === null) return;
      toast.success('Exported', saved || collection.name);
    } else {
      // Whole-workspace export: every collection + every environment, kapi-native.
      const payload = { workspace, exportedAt: new Date().toISOString(), format: 'kapi/1' };
      const saved = await download(`${workspace.name}.kapi-workspace.json`, payload);
      if (saved === null) return;
      toast.success('Exported workspace', saved || workspace.name);
    }
    onClose();
  };

  const exportEnvironment = async (envId: string) => {
    const env = workspace.environments.find((e) => e.id === envId);
    if (!env) return;
    const saved = await download(`${env.name}.postman_environment.json`, exportPostmanEnvironment(env));
    if (saved === null) return;
    toast.success('Exported environment', saved || env.name);
  };

  return (
    <Modal open={open} onClose={onClose} title={collection ? `Export "${collection.name}"` : 'Export workspace'} width={440}>
      <div className="flex flex-col gap-4">
        {collection && (
          <Segmented
            value={format}
            onChange={setFormat}
            options={[
              { value: 'postman', label: 'Postman v2.1' },
              { value: 'har', label: 'HAR (from history)' },
              { value: 'kapi', label: 'kapi native' },
            ]}
          />
        )}
        <p className="text-[11.5px] leading-relaxed text-faint">
          {collection && format === 'har'
            ? 'Exports your whole request history (not just this collection) as a HAR file — downloaded straight from your browser.'
            : collection
              ? 'Downloads a file straight from your browser — nothing is uploaded anywhere.'
              : 'Bundles every collection and environment in this workspace into one file you can re-import later.'}
        </p>
        <Button variant="primary" onClick={doExport}>
          <Download size={13} /> Download
        </Button>

        {!collection && workspace.environments.length > 0 && (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Or export one environment</p>
            <div className="flex flex-col gap-1">
              {workspace.environments.map((env) => (
                <button
                  key={env.id}
                  onClick={() => exportEnvironment(env.id)}
                  className="flex h-8 items-center gap-2 rounded px-2 text-left text-[12.5px] text-dim hover:bg-surface-2 hover:text-fg"
                >
                  <LinkIcon size={12} /> {env.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
