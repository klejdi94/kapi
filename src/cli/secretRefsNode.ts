import { execFile } from 'node:child_process';

/**
 * The CLI's resolver for op:// · awssm:// · vault:// references — the same
 * rules as the desktop app's src-tauri/src/secret_refs.rs: a fixed argument
 * list per provider, no shell, and every piece of the reference checked so it
 * can't become an option. Only used when `--secret-refs` is passed, which is
 * the CLI's equivalent of the app's per-reference consent.
 */

export type ParsedRef =
  | { kind: 'op'; reference: string }
  | { kind: 'awssm'; secretId: string; region?: string; jsonKey?: string }
  | { kind: 'vault'; path: string; field: string };

function safePiece(piece: string, what: string): string {
  if (!piece) throw new Error(`The reference is missing its ${what}`);
  if (piece.startsWith('-')) throw new Error(`The ${what} can't start with '-'`);
  if (/[\s\p{Cc}]/u.test(piece)) throw new Error(`The ${what} can't contain spaces or control characters`);
  return piece;
}

export function parseSecretRef(input: string): ParsedRef {
  const reference = input.trim();
  if (reference.startsWith('op://')) {
    if (reference.slice(5).split('/').filter(Boolean).length < 3) throw new Error('1Password references look like op://vault/item/field');
    return { kind: 'op', reference: safePiece(reference, '1Password reference') };
  }
  if (reference.startsWith('awssm://')) {
    let rest = reference.slice(8);
    let jsonKey: string | undefined;
    const hash = rest.indexOf('#');
    if (hash !== -1) {
      jsonKey = safePiece(rest.slice(hash + 1), 'JSON key');
      rest = rest.slice(0, hash);
    }
    let region: string | undefined;
    const q = rest.indexOf('?region=');
    if (q !== -1) {
      region = safePiece(rest.slice(q + 8), 'region');
      rest = rest.slice(0, q);
    }
    return { kind: 'awssm', secretId: safePiece(rest, 'secret id'), region, jsonKey };
  }
  if (reference.startsWith('vault://')) {
    const rest = reference.slice(8);
    const hash = rest.indexOf('#');
    if (hash === -1) throw new Error('Vault references look like vault://path/to/secret#field');
    return { kind: 'vault', path: safePiece(rest.slice(0, hash), 'path'), field: safePiece(rest.slice(hash + 1), 'field') };
  }
  throw new Error('Not a secret reference (op://, awssm:// or vault://)');
}

export function commandFor(ref: ParsedRef): [string, string[]] {
  switch (ref.kind) {
    case 'op':
      return ['op', ['read', '--no-newline', ref.reference]];
    case 'awssm':
      return ['aws', ['secretsmanager', 'get-secret-value', '--secret-id', ref.secretId, '--query', 'SecretString', '--output', 'text', ...(ref.region ? ['--region', ref.region] : [])]];
    case 'vault':
      return ['vault', ['kv', 'get', `-field=${ref.field}`, ref.path]];
  }
}

export async function resolveSecretRefNode(reference: string): Promise<string> {
  const ref = parseSecretRef(reference);
  const [program, args] = commandFor(ref);
  const raw = await new Promise<string>((resolve, reject) => {
    execFile(program, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        reject(new Error(code === 'ENOENT' ? `The \`${program}\` CLI isn't installed (or isn't on PATH)` : `${program}: ${String(stderr).trim() || err.message}`));
      } else {
        resolve(String(stdout).replace(/\r?\n$/, ''));
      }
    });
  });
  if (ref.kind === 'awssm' && ref.jsonKey) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error('The secret isn\'t JSON, so it has no #key to pick');
    }
    if (!(ref.jsonKey in json)) throw new Error(`The secret has no key "${ref.jsonKey}"`);
    const value = json[ref.jsonKey];
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return raw;
}
