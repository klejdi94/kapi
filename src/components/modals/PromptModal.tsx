import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Input } from '@/components/ui/primitives';

/**
 * Stands in for `window.prompt`, which the macOS webview never implements —
 * it silently returns null, so anything gated on it looks like a no-op.
 */
export function PromptModal({
  open,
  title,
  label,
  defaultValue = '',
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  defaultValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width={400}>
      <label className="mb-1.5 block text-[11.5px] font-medium text-dim">{label}</label>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!value.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
