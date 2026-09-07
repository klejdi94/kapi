#!/usr/bin/env -S npx tsx
/**
 * Registers kapi's MCP server on every AI CLI actually installed on this
 * machine (`claude`, `codex`, `gemini`), and copies the companion skill to
 * Claude Code's global skills folder so it's available from any project,
 * not just this repo. Safe to re-run — each `mcp add` overwrites its own
 * prior registration under the same name instead of duplicating it.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(repoRoot, 'mcp', 'server.ts');

function hasCli(name: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'inherit' });
    return true;
  } catch (err) {
    console.error(`  ✗ ${command} ${args.join(' ')} failed: ${(err as Error).message}`);
    return false;
  }
}

console.log(`Registering kapi's MCP server (${serverPath}) on installed AI CLIs...\n`);

// `-s user` / `--scope user` on both: kapi is meant to be reachable from
// whatever backend project the AI is invoked in, not only this repo, so the
// default project/local scope each CLI otherwise picks is the wrong one.
// codex has no scope flag — `codex mcp add` already registers globally.
let any = false;
if (hasCli('claude')) {
  any = true;
  console.log('› claude mcp add kapi');
  run('claude', ['mcp', 'add', 'kapi', '-s', 'user', '--', 'npx', 'tsx', serverPath]);
} else {
  console.log('· claude CLI not found, skipping');
}

if (hasCli('codex')) {
  any = true;
  console.log('› codex mcp add kapi');
  run('codex', ['mcp', 'add', 'kapi', '--', 'npx', 'tsx', serverPath]);
} else {
  console.log('· codex CLI not found, skipping');
}

if (hasCli('gemini')) {
  any = true;
  console.log('› gemini mcp add kapi');
  run('gemini', ['mcp', 'add', 'kapi', 'npx', 'tsx', serverPath, '-s', 'user']);
} else {
  console.log('· gemini CLI not found, skipping');
}

// Claude Code skills are discovered globally from ~/.claude/skills/<name>/SKILL.md.
// Codex and Gemini have no equivalent concept — for those the MCP tools'
// own descriptions carry the same guidance instead.
const skillDir = join(homedir(), '.claude', 'skills', 'kapi');
try {
  mkdirSync(skillDir, { recursive: true });
  const src = join(repoRoot, 'mcp', 'skill', 'SKILL.md');
  if (existsSync(src)) {
    copyFileSync(src, join(skillDir, 'SKILL.md'));
    console.log(`\n✓ Installed the kapi skill for Claude Code at ${join(skillDir, 'SKILL.md')}`);
  }
} catch (err) {
  console.error(`\n✗ Could not install the Claude Code skill: ${(err as Error).message}`);
}

if (!any) {
  console.log('\nNo supported AI CLI (claude, codex, gemini) was found on PATH — install one first, then re-run `npm run mcp:install`.');
}
