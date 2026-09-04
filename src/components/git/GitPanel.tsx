import { useEffect, useState } from 'react';
import { FolderGit2, GitBranch, GitCommitHorizontal, RefreshCw, Unlink, UploadCloud, DownloadCloud } from 'lucide-react';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { Button, EmptyState, IconButton, Badge } from '@/components/ui/primitives';
import { DiffView } from './DiffView';
import { toast } from '@/lib/toast';
import * as git from '@/lib/git';
import { ensureRepo, readPanelState, readSnapshot, writeSnapshot, type GitPanelState } from '@/lib/gitWorkspace';

export function GitPanel() {
  const workspace = useActiveWorkspace();
  const setGitRepoPath = useWorkspaces((s) => s.setGitRepoPath);
  const replaceCollections = useWorkspaces((s) => s.replaceCollections);

  const [state, setState] = useState<GitPanelState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');

  const path = workspace.gitRepoPath;

  const refresh = async (repoPath: string) => {
    setLoading(true);
    try {
      setState(await readPanelState(repoPath));
    } catch (err) {
      toast.error('Could not read git status', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (path) refresh(path);
    else setState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!git.gitAvailable()) {
    return (
      <EmptyState
        icon={<FolderGit2 size={22} />}
        title="Git sync needs the desktop app"
        detail="Run kapi with npm run desktop:dev or the packaged app — a browser tab can't shell out to git."
      />
    );
  }

  const link = async () => {
    const folder = await git.pickFolder();
    if (!folder) return;
    setLoading(true);
    try {
      const initResult = await ensureRepo(folder);
      if (!initResult.ok) {
        toast.error("Couldn't prepare that folder", initResult.message);
        return;
      }
      const existing = await readSnapshot(folder);
      if (existing) {
        const loadExisting = confirm(
          `This folder already has a kapi workspace ("${existing.name}", ${existing.collections.length} collection(s)).\n\n` +
            'Load it into kapi (replacing what\'s open now)? Cancel to overwrite the folder with what\'s open now instead.',
        );
        if (loadExisting) {
          replaceCollections(existing.collections);
          toast.success('Loaded workspace from folder');
        }
      }
      setGitRepoPath(folder);
      await writeSnapshot({ ...workspace, gitRepoPath: folder });
      toast.success('Linked to git folder', folder);
    } finally {
      setLoading(false);
    }
  };

  const unlink = () => {
    if (!confirm('Unlink this workspace from its git folder? The folder itself is untouched.')) return;
    setGitRepoPath(null);
  };

  const sync = async () => {
    if (!path) return;
    setLoading(true);
    try {
      await writeSnapshot(workspace);
      await refresh(path);
      toast.success('Synced to folder');
    } finally {
      setLoading(false);
    }
  };

  const doCommit = async () => {
    if (!path || !message.trim()) return;
    setLoading(true);
    try {
      await writeSnapshot(workspace);
      const result = await git.commit(path, message.trim());
      if (result.ok) {
        setMessage('');
        toast.success('Committed');
      } else {
        toast.error('Commit failed', result.stderr || 'Nothing to commit, or git rejected it.');
      }
      await refresh(path);
    } finally {
      setLoading(false);
    }
  };

  const doPush = async () => {
    if (!path) return;
    setLoading(true);
    try {
      const result = await git.push(path);
      result.ok ? toast.success('Pushed') : toast.error('Push failed', result.stderr);
      await refresh(path);
    } finally {
      setLoading(false);
    }
  };

  const doPull = async () => {
    if (!path) return;
    setLoading(true);
    try {
      const result = await git.pull(path);
      if (result.ok) {
        const snapshot = await readSnapshot(path);
        if (snapshot) replaceCollections(snapshot.collections);
        toast.success('Pulled');
      } else {
        toast.error('Pull failed', result.stderr);
      }
      await refresh(path);
    } finally {
      setLoading(false);
    }
  };

  const addRemote = async () => {
    if (!path || !remoteUrl.trim()) return;
    const result = await git.addRemote(path, remoteUrl.trim());
    if (result.ok) {
      toast.success('Remote added');
      setRemoteUrl('');
      await refresh(path);
    } else {
      toast.error('Could not add remote', result.stderr);
    }
  };

  if (!path) {
    return (
      <EmptyState
        icon={<FolderGit2 size={22} />}
        title="Sync this workspace to a git repo"
        detail="Collections and requests are written to a JSON file in a folder you choose, so you get real commits, diffs, and history — reviewable the same way as any other code change. Environments stay out of it, since they often hold secrets."
        action={
          <Button variant="primary" onClick={link}>
            <FolderGit2 size={13} /> Choose a folder
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <FolderGit2 size={14} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-dim" title={path}>
          {path}
        </span>
        {state?.branch && (
          <Badge tone="info" className="shrink-0">
            <GitBranch size={10} /> {state.branch}
          </Badge>
        )}
        <IconButton label="Refresh" onClick={() => refresh(path)}>
          <RefreshCw size={13} className={loading ? 'animate-spin-slow' : ''} />
        </IconButton>
        <IconButton label="Unlink" tone="danger" onClick={unlink}>
          <Unlink size={13} />
        </IconButton>
      </div>

      {!state?.hasRemote && (
        <div className="flex items-center gap-2 border-b border-line bg-warn/10 px-3 py-2">
          <span className="text-[11.5px] text-warn">No remote set —</span>
          <input
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            placeholder="git@github.com:you/repo.git"
            className="h-6.5 flex-1 rounded border border-line bg-surface px-2 font-mono text-[11.5px] focus:border-accent focus:outline-none"
          />
          <Button size="sm" onClick={addRemote} disabled={!remoteUrl.trim()}>
            Add remote
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" onClick={sync} disabled={loading}>
          <RefreshCw size={12} /> Sync now
        </Button>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message"
          onKeyDown={(e) => e.key === 'Enter' && doCommit()}
          className="h-7 flex-1 rounded border border-line bg-surface px-2 text-[12px] focus:border-accent focus:outline-none"
        />
        <Button size="sm" variant="primary" onClick={doCommit} disabled={loading || !message.trim() || !state?.changes.length}>
          <GitCommitHorizontal size={12} /> Commit
        </Button>
        <Button size="sm" onClick={doPull} disabled={loading || !state?.hasRemote}>
          <DownloadCloud size={12} /> Pull
        </Button>
        <Button size="sm" onClick={doPush} disabled={loading || !state?.hasRemote}>
          <UploadCloud size={12} /> Push
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DiffView diffText={state?.diffText ?? ''} />

        {!!state?.recentCommits.length && (
          <div className="border-t border-line p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">Recent commits</p>
            <div className="flex flex-col gap-1">
              {state.recentCommits.map((c) => (
                <div key={c.hash} className="flex items-center gap-2 text-[12px]">
                  <span className="font-mono text-faint">{c.hash}</span>
                  <span className="min-w-0 flex-1 truncate text-dim">{c.message}</span>
                  <span className="shrink-0 text-[10.5px] text-faint">{c.at}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
