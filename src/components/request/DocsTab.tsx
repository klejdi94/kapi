import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/ui/primitives';

/**
 * Free-form markdown notes for a saved request — shown here for editing and
 * pulled into the collection's exported docs (Markdown / OpenAPI `description`).
 * Only meaningful once the request has a home in a collection.
 */
export function DocsTab({
  description,
  onChange,
  canEdit,
}: {
  description: string;
  onChange: (description: string) => void;
  canEdit: boolean;
}) {
  if (!canEdit) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={<FileText size={22} />}
          title="Save this request first"
          detail="Docs live on the saved request, so there's somewhere for them to persist to."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 p-4">
      <p className="text-[11.5px] leading-relaxed text-faint">
        Markdown notes for this request — what it does, quirks, gotchas. Shown in the collection's
        exported docs alongside its headers, params and body.
      </p>
      <textarea
        value={description}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Returns the signed-in user's profile. Requires the `Authorization` header set by the collection's pre-request script."
        className="min-h-0 flex-1 resize-none rounded-md border border-line bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-fg focus:border-accent focus:outline-none"
      />
    </div>
  );
}
