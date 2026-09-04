import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Segmented } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';

type Phase = 'pre' | 'test';

const PLACEHOLDER: Record<Phase, string> = {
  pre: '// Runs before every request in this collection.\n// pm.environment.set(...), pm.variables.get(...)',
  test: "// Runs after every response in this collection.\n// pm.test('is ok', () => pm.expect(pm.response.code).to.equal(200));",
};

/** Collection-wide `pm` scripts — they run ahead of each request's own scripts. */
export function CollectionScriptsModal({ collectionId, onClose }: { collectionId: string | null; onClose: () => void }) {
  const workspace = useActiveWorkspace();
  const updateCollection = useWorkspaces((s) => s.updateCollection);
  const [phase, setPhase] = useState<Phase>('pre');

  const collection = collectionId ? workspace.collections.find((c) => c.id === collectionId) : null;
  if (!collection) return null;

  const value = (phase === 'pre' ? collection.preRequestScript : collection.testScript) ?? '';
  const set = (next: string) =>
    updateCollection(collection.id, phase === 'pre' ? { preRequestScript: next } : { testScript: next });

  return (
    <Modal open onClose={onClose} title={`Scripts — ${collection.name}`} width={720}>
      <Segmented
        value={phase}
        onChange={setPhase}
        options={[
          { value: 'pre', label: 'Pre-request', dot: !!collection.preRequestScript?.trim() },
          { value: 'test', label: 'Tests', dot: !!collection.testScript?.trim() },
        ]}
      />
      <p className="mt-2 mb-2 text-[11.5px] leading-relaxed text-faint">
        Runs for every request in this collection, before that request&rsquo;s own {phase === 'pre' ? 'pre-request' : 'test'} script.
      </p>
      <div className="h-80 overflow-hidden rounded-md border border-line">
        <CodeEditor value={value} onChange={set} language="javascript" placeholder={PLACEHOLDER[phase]} />
      </div>
    </Modal>
  );
}
