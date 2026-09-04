import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Select, IconButton } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/ui/Editor';
import { CODEGEN_LABELS, generate, type CodegenTarget } from '@/lib/codegen';
import type { RequestDef } from '@/types';
import { prepare } from '@/lib/send';
import { buildScope } from '@/lib/variables';
import { useActiveWorkspace, findCollection } from '@/store/workspaces';
import { resolveInheritedForNode } from '@/lib/inherit';
import { toast } from '@/lib/toast';
import { useEffect } from 'react';

const TARGETS = Object.keys(CODEGEN_LABELS) as CodegenTarget[];

export function CodeSnippetModal({
  open,
  onClose,
  request,
  collectionId,
  nodeId,
}: {
  open: boolean;
  onClose: () => void;
  request: RequestDef;
  collectionId: string | null;
  nodeId: string | null;
}) {
  const [target, setTarget] = useState<CodegenTarget>('curl');
  const [code, setCode] = useState('');
  const workspace = useActiveWorkspace();
  const collection = findCollection(workspace, collectionId);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const scope = buildScope(workspace, collection);
      const resolved = resolveInheritedForNode(request, collection, nodeId);
      try {
        const { sent } = await prepare(resolved, scope);
        if (!cancelled) setCode(generate(target, sent));
      } catch (err) {
        if (!cancelled) setCode(`// Could not build this request: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, request]);

  const language = useMemo(() => {
    if (target.startsWith('js-') || target === 'node-https') return 'javascript' as const;
    return 'text' as const;
  }, [target]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate code" width={640}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <Select value={target} onChange={(e) => setTarget(e.target.value as CodegenTarget)} className="w-56">
          {TARGETS.map((t) => (
            <option key={t} value={t}>
              {CODEGEN_LABELS[t]}
            </option>
          ))}
        </Select>
        <IconButton label="Copy" onClick={copy}>
          <Copy size={14} />
        </IconButton>
      </div>
      <div className="h-80 overflow-hidden rounded-md border border-line bg-surface">
        <CodeEditor value={code} language={language} readOnly wrap />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-faint">
        Generated from the request exactly as it would be sent — variables resolved, auth applied.
      </p>
    </Modal>
  );
}
