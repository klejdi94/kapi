import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Select } from '@/components/ui/primitives';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { useSession } from '@/store/session';
import { newRequestNode, newWebSocketNode } from '@/lib/factory';
import { toast } from '@/lib/toast';

export function SaveAsModal({ open, onClose, tabId }: { open: boolean; onClose: () => void; tabId: string | null }) {
  const workspace = useActiveWorkspace();
  const addNode = useWorkspaces((s) => s.addNode);
  const addCollection = useWorkspaces((s) => s.addCollection);
  const tabs = useSession((s) => s.tabs);
  const patchTab = useSession((s) => s.patchTab);

  const tab = tabs.find((t) => t.id === tabId) ?? null;
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');

  useEffect(() => {
    if (open && tab) {
      setName(tab.name === 'Untitled request' ? '' : tab.name);
      setCollectionId(workspace.collections[0]?.id ?? '');
    }
  }, [open, tab, workspace.collections]);

  if (!tab) return null;

  const save = () => {
    const finalName = name.trim() || (tab.kind === 'ws' ? 'New WebSocket' : 'Untitled request');
    let targetCollectionId = collectionId;
    if (!targetCollectionId) {
      targetCollectionId = addCollection('My collection');
    }
    const node = tab.kind === 'ws' && tab.ws ? newWebSocketNode(finalName, tab.ws) : newRequestNode(finalName, tab.request);
    addNode(targetCollectionId, null, node);
    patchTab(tab.id, { nodeId: node.id, collectionId: targetCollectionId, name: finalName, dirty: false });
    toast.success('Saved', finalName);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Save request" width={420}>
      <div className="flex flex-col gap-4">
        <Field label="Request name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={(tab.kind === 'ws' ? tab.ws?.url : tab.request.url) || 'My request'}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
          />
        </Field>
        <Field label="Collection" hint={workspace.collections.length === 0 ? 'A new collection will be created.' : undefined}>
          <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
            {workspace.collections.length === 0 && <option value="">My collection (new)</option>}
            {workspace.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
