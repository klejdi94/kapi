import { Command } from '@tauri-apps/plugin-shell';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { isDesktop } from './transport';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Each git invocation kapi makes has its own named entry in
 * `src-tauri/capabilities/default.json`, with its arguments pinned there —
 * the webview can't run git with arbitrary flags (`-c core.sshCommand=…`,
 * `--upload-pack=…` and friends are a short step from running any command).
 * Adding a new git call means adding its scope entry too.
 */
type GitCommand =
  | 'git-rev-parse'
  | 'git-init'
  | 'git-remote'
  | 'git-remote-add'
  | 'git-status'
  | 'git-diff'
  | 'git-diff-untracked'
  | 'git-add'
  | 'git-commit'
  | 'git-push'
  | 'git-pull'
  | 'git-log'
  | 'git-branch';

async function git(cwd: string, name: GitCommand, args: string[]): Promise<GitResult> {
  const command = Command.create(name, args, { cwd });
  const output = await command.execute();
  return { ok: output.code === 0, stdout: output.stdout, stderr: output.stderr, code: output.code };
}

/** Same rule as the `git-remote-add` scope validator in capabilities/default.json. */
export const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git@)[^\s\-][^\s]*$/;

export function gitAvailable(): boolean {
  return isDesktop();
}

/** Opens the native folder picker. Returns null if the user cancelled. */
export async function pickFolder(): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false, title: 'Choose a folder for this workspace' });
  return typeof selected === 'string' ? selected : null;
}

export async function isGitRepo(path: string): Promise<boolean> {
  const result = await git(path, 'git-rev-parse', ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

export async function initRepo(path: string): Promise<GitResult> {
  return git(path, 'git-init', ['init']);
}

export async function hasRemote(path: string): Promise<boolean> {
  const result = await git(path, 'git-remote', ['remote']);
  return result.ok && result.stdout.trim().length > 0;
}

export async function addRemote(path: string, url: string): Promise<GitResult> {
  // Mirrors the scope's validator, so a bad URL gets a readable error instead of a scope rejection.
  if (!REMOTE_URL.test(url.trim())) {
    return { ok: false, stdout: '', stderr: 'Use an https://, ssh:// or git@host:path remote URL.', code: null };
  }
  url = url.trim();
  return git(path, 'git-remote-add', ['remote', 'add', 'origin', url]);
}

export interface GitStatusEntry {
  path: string;
  /** Raw two-letter porcelain status, e.g. " M", "??", "A ". */
  code: string;
}

export async function status(path: string): Promise<GitStatusEntry[]> {
  const result = await git(path, 'git-status', ['status', '--porcelain']);
  if (!result.ok) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
}

/** Unstaged + untracked diff against the working tree, unified format. */
export async function diff(path: string): Promise<string> {
  const [tracked, untrackedFiles] = await Promise.all([git(path, 'git-diff', ['diff', '--', '.']), status(path)]);
  const untracked = untrackedFiles.filter((e) => e.code === '??');
  const untrackedDiffs = await Promise.all(
    untracked.map(async (entry) => {
      const result = await git(path, 'git-diff-untracked', ['diff', '--no-index', '--', '/dev/null', entry.path]);
      // --no-index exits 1 when it finds a difference, which is the expected case here.
      return result.stdout;
    }),
  );
  return [tracked.stdout, ...untrackedDiffs].filter(Boolean).join('\n');
}

export async function commit(path: string, message: string): Promise<GitResult> {
  const add = await git(path, 'git-add', ['add', '-A']);
  if (!add.ok) return add;
  return git(path, 'git-commit', ['commit', '-m', message]);
}

export async function push(path: string): Promise<GitResult> {
  return git(path, 'git-push', ['push', '-u', 'origin', 'HEAD']);
}

export async function pull(path: string): Promise<GitResult> {
  return git(path, 'git-pull', ['pull']);
}

const LOG_FIELD_SEP = String.fromCharCode(31); // unit separator, won't appear in commit subjects
const LOG_RECORD_SEP = String.fromCharCode(30); // record separator

export interface GitLogEntry {
  hash: string;
  message: string;
  at: string;
}

export async function log(path: string, limit = 20): Promise<GitLogEntry[]> {
  const format = ['%h', '%s', '%ar'].join(LOG_FIELD_SEP) + LOG_RECORD_SEP;
  const result = await git(path, 'git-log', ['log', `-${limit}`, `--pretty=format:${format}`]);
  if (!result.ok) return [];
  return result.stdout
    .split(LOG_RECORD_SEP)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, message, at] = record.split(LOG_FIELD_SEP);
      return { hash: hash ?? '', message: message ?? '', at: at ?? '' };
    });
}

export async function currentBranch(path: string): Promise<string> {
  const result = await git(path, 'git-branch', ['branch', '--show-current']);
  return result.ok ? result.stdout.trim() : '';
}
