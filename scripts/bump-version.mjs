// Usage: node scripts/bump-version.mjs 0.4.0
// Sets the version everywhere a release needs it to agree: the app's
// package.json (source of truth for the frontend, CLI and MCP server),
// package-lock.json, the npm package, Cargo.toml/Cargo.lock and tauri.conf.json
// (which the updater compares against latest.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/bump-version.mjs <semver>, e.g. 0.4.0');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function editJson(file, apply) {
  const path = join(root, file);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  apply(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ${file}`);
}

function editText(file, pattern, replacement) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf-8');
  const after = before.replace(pattern, replacement);
  if (after === before) throw new Error(`${file}: version pattern not found`);
  writeFileSync(path, after);
  console.log(`  ${file}`);
}

console.log(`Setting version ${version} in:`);
editJson('package.json', (d) => (d.version = version));
editJson('package-lock.json', (d) => {
  d.version = version;
  if (d.packages?.['']) d.packages[''].version = version;
});
editJson('npm/package.json', (d) => (d.version = version));
editJson('src-tauri/tauri.conf.json', (d) => (d.version = version));
editText('src-tauri/Cargo.toml', /^version = "[^"]+"/m, `version = "${version}"`);
editText('src-tauri/Cargo.lock', /(\[\[package\]\]\nname = "app"\nversion = )"[^"]+"/, `$1"${version}"`);
console.log(`\nThen: commit, and \`git tag v${version} && git push origin v${version}\`.`);
