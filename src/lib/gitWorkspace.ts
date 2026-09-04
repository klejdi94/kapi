import type { Collection, Workspace } from '@/types';
import { readTextFile, writeTextFile, pathExists, joinPath } from './fs';
import * as git from './git';

export const SNAPSHOT_FILENAME = 'kapi-workspace.json';

export interface WorkspaceSnapshot {
  format: 'kapi-workspace/1';
  name: string;
  collections: Collection[];
}

/**
 * Environments are deliberately left out of the git snapshot: they're the
 * one place people routinely put real API keys and tokens, and "sync to git"
 * should not be a surprise way to commit a secret. Collections — requests,
 * folders, auth *shapes*, {{variable}} references — have no such landmine.
 */
export function toSnapshot(workspace: Workspace): WorkspaceSnapshot {
  return { format: 'kapi-workspace/1', name: workspace.name, collections: workspace.collections };
}

export function snapshotPath(gitRepoPath: string): string {
  return joinPath(gitRepoPath, SNAPSHOT_FILENAME);
}

export async function writeSnapshot(workspace: Workspace): Promise<void> {
  if (!workspace.gitRepoPath) return;
  const snapshot = toSnapshot(workspace);
  // Stable key order so unrelated field reordering never shows up as noise
  // in `git diff` — the entire point of this feature.
  await writeTextFile(snapshotPath(workspace.gitRepoPath), JSON.stringify(snapshot, null, 2) + '\n');
}

export async function readSnapshot(gitRepoPath: string): Promise<WorkspaceSnapshot | null> {
  const path = snapshotPath(gitRepoPath);
  if (!(await pathExists(path))) return null;
  try {
    const text = await readTextFile(path);
    const data = JSON.parse(text) as WorkspaceSnapshot;
    if (data.format !== 'kapi-workspace/1' || !Array.isArray(data.collections)) return null;
    return data;
  } catch {
    return null;
  }
}

export interface LinkResult {
  ok: boolean;
  message: string;
}

/** Ensures the folder is a git repo (initializing one if it's brand new). */
export async function ensureRepo(gitRepoPath: string): Promise<LinkResult> {
  if (await git.isGitRepo(gitRepoPath)) return { ok: true, message: 'Already a git repository.' };
  const result = await git.initRepo(gitRepoPath);
  return result.ok
    ? { ok: true, message: 'Initialized a new git repository.' }
    : { ok: false, message: result.stderr || 'git init failed.' };
}

export interface GitPanelState {
  branch: string;
  hasRemote: boolean;
  changes: git.GitStatusEntry[];
  diffText: string;
  recentCommits: git.GitLogEntry[];
}

export async function readPanelState(gitRepoPath: string): Promise<GitPanelState> {
  const [branch, remote, changes, diffText, recentCommits] = await Promise.all([
    git.currentBranch(gitRepoPath),
    git.hasRemote(gitRepoPath),
    git.status(gitRepoPath),
    git.diff(gitRepoPath),
    git.log(gitRepoPath, 15),
  ]);
  return { branch, hasRemote: remote, changes, diffText, recentCommits };
}
