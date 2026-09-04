import { useRef, useState } from 'react';
import { FileUp, Terminal } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/primitives';
import { useWorkspaces } from '@/store/workspaces';
import { toast } from '@/lib/toast';
import { looksLikePostmanCollection, looksLikePostmanEnvironment, importPostmanCollection, importPostmanEnvironment } from '@/lib/importers/postman';
import { looksLikeOpenApi, parseOpenApiText, importOpenApi } from '@/lib/importers/openapi';
import { looksLikeHar, importHar } from '@/lib/importers/har';
import { looksLikeInsomnia, importInsomnia } from '@/lib/importers/insomnia';
import { looksLikeCurl, parseCurl } from '@/lib/importers/curl';
import { newCollection } from '@/lib/factory';

export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const importCollection = useWorkspaces((s) => s.importCollection);
  const importEnvironment = useWorkspaces((s) => s.importEnvironment);
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const runImport = (raw: string, filename?: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    try {
      if (looksLikeCurl(trimmed)) {
        const request = parseCurl(trimmed);
        if (!request) throw new Error('Could not parse that cURL command.');
        const collection = newCollection('Imported from cURL');
        collection.items = [{ id: crypto.randomUUID(), type: 'request', name: request.method + ' ' + (new URL(/^https?:\/\//.test(request.url) ? request.url : `https://${request.url}`).pathname || '/'), request }];
        importCollection(collection);
        toast.success('Imported from cURL', collection.name);
        onClose();
        return;
      }

      // Try structured formats. YAML/JSON both parse through the OpenAPI reader.
      let data: unknown;
      const looksYaml = /\.ya?ml$/i.test(filename ?? '') || (!trimmed.startsWith('{') && !trimmed.startsWith('['));
      try {
        data = looksYaml ? parseOpenApiText(trimmed) : JSON.parse(trimmed);
      } catch {
        data = parseOpenApiText(trimmed);
      }

      if (looksLikePostmanCollection(data)) {
        const collection = importPostmanCollection(data);
        importCollection(collection);
        toast.success('Imported Postman collection', `${collection.name} — ${collection.items.length} items`);
      } else if (looksLikePostmanEnvironment(data)) {
        const env = importEnvironment(importPostmanEnvironment(data));
        void env;
        toast.success('Imported Postman environment');
      } else if (looksLikeOpenApi(data)) {
        const { collection, environment } = importOpenApi(data);
        importCollection(collection);
        if (environment) importEnvironment(environment);
        toast.success('Imported OpenAPI spec', `${collection.name} — ${collection.items.length} operations`);
      } else if (looksLikeHar(data)) {
        const collection = importHar(data, filename?.replace(/\.har$/i, '') || 'Imported from HAR');
        importCollection(collection);
        toast.success('Imported HAR', `${collection.items.length} requests`);
      } else if (looksLikeInsomnia(data)) {
        const collection = importInsomnia(data);
        importCollection(collection);
        toast.success('Imported from Insomnia', `${collection.items.length} requests`);
      } else {
        throw new Error('This doesn’t look like a Postman collection/environment, OpenAPI spec, HAR file, Insomnia export, or cURL command.');
      }
      onClose();
      setText('');
    } catch (err) {
      toast.error('Import failed', (err as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import" width={560}>
      <p className="mb-3 text-[12px] leading-relaxed text-faint">
        Paste a Postman collection or environment, an OpenAPI/Swagger spec (JSON or YAML), a HAR file, an
        Insomnia v4 export, or a <code>curl</code> command — kapi detects the format automatically.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste JSON, YAML, or a curl command…"
        rows={10}
        spellCheck={false}
        className="w-full resize-none rounded-md border border-line bg-surface p-2.5 font-mono text-[12px] text-fg placeholder:font-sans focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" onClick={() => runImport(text)} disabled={!text.trim()}>
          <Terminal size={13} /> Import
        </Button>
        <Button onClick={() => fileInput.current?.click()}>
          <FileUp size={13} /> Choose a file…
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.yaml,.yml,.har"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const content = await file.text();
            runImport(content, file.name);
            e.target.value = '';
          }}
        />
      </div>
    </Modal>
  );
}
