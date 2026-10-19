// Fails when an @tauri-apps npm package and its Rust crate are on different
// major.minor versions — `tauri build` refuses to build then, which would
// otherwise first show up in the (slow, tag-triggered) release workflow.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8')).packages;
const cargo = readFileSync(join(root, 'src-tauri', 'Cargo.lock'), 'utf-8');

const crates = new Map();
for (const match of cargo.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) crates.set(match[1], match[2]);

const pairs = [['@tauri-apps/api', 'tauri']];
for (const key of Object.keys(lock)) {
  const m = /^node_modules\/@tauri-apps\/plugin-(.+)$/.exec(key);
  if (m) pairs.push([`@tauri-apps/plugin-${m[1]}`, `tauri-plugin-${m[1]}`]);
}

const minor = (v) => v.split('.').slice(0, 2).join('.');
let bad = 0;
for (const [npm, crate] of pairs) {
  const nv = lock[`node_modules/${npm}`]?.version;
  const cv = crates.get(crate);
  if (!nv || !cv) continue;
  const ok = minor(nv) === minor(cv);
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${npm} ${nv}  ↔  ${crate} ${cv}`);
}
if (bad) {
  console.error(`\n${bad} mismatch(es): bump the Rust crate (Cargo.toml + cargo update -p …) or pin the npm package so both share major.minor.`);
  process.exit(1);
}
