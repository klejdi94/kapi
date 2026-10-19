// Bundles the headless runner + MCP server into npm/dist for `npx kapi`.
// Everything is inlined, so the published package has no dependencies to install.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'npm', 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, 'cli', 'bin.ts')],
  outdir: out,
  entryNames: 'kapi',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  alias: { '@': join(root, 'src') },
  // Some dependencies still `require()` Node built-ins from inside ESM.
  banner: { js: "import { createRequire as __kapiCreateRequire } from 'node:module'; const require = __kapiCreateRequire(import.meta.url);" },
  legalComments: 'external',
  logLevel: 'info',
});

copyFileSync(join(root, 'mcp', 'skill', 'SKILL.md'), join(out, 'SKILL.md'));
copyFileSync(join(root, 'LICENSE'), join(root, 'npm', 'LICENSE'));

// Keep npm/package.json's version in lockstep with the app's.
const appPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const npmPkgPath = join(root, 'npm', 'package.json');
const npmPkg = JSON.parse(readFileSync(npmPkgPath, 'utf-8'));
npmPkg.version = appPkg.version;
writeFileSync(npmPkgPath, JSON.stringify(npmPkg, null, 2) + '\n');
