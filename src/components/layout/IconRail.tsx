import { Bot, FolderTree, GitBranch, History, Layers, Server } from 'lucide-react';
import { useSession, type SidebarPanel } from '@/store/session';

const ITEMS: { value: SidebarPanel; label: string; shortLabel: string; icon: typeof FolderTree }[] = [
  { value: 'collections', label: 'Collections', shortLabel: 'Collections', icon: FolderTree },
  { value: 'environments', label: 'Environments', shortLabel: 'Env', icon: Layers },
  { value: 'history', label: 'History', shortLabel: 'History', icon: History },
  { value: 'git', label: 'Git', shortLabel: 'Git', icon: GitBranch },
  { value: 'mock', label: 'Mock Servers', shortLabel: 'Mock', icon: Server },
  { value: 'ai', label: 'Ask Claude', shortLabel: 'AI', icon: Bot },
];

/** The fixed-width icon column on the far left, à la Postman's own sidebar rail. */
export function IconRail() {
  const panel = useSession((s) => s.sidebarPanel);
  const sidebarOpen = useSession((s) => s.sidebarOpen);
  const setSession = useSession((s) => s.set);

  const select = (value: SidebarPanel) => {
    setSession('sidebarPanel', value);
    if (!sidebarOpen) setSession('sidebarOpen', true);
  };

  return (
    <div className="flex w-18 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-2 py-2.5">
      {ITEMS.map(({ value, label, shortLabel, icon: Icon }) => {
        const active = sidebarOpen && panel === value;
        return (
          <button
            key={value}
            onClick={() => select(value)}
            title={label}
            className={`flex w-15 flex-col items-center gap-1.5 rounded-md py-2 text-[10px] transition-colors ${
              active ? 'bg-accent/15 text-accent' : 'text-faint hover:bg-surface-3 hover:text-fg'
            }`}
          >
            <Icon size={19} />
            <span className="leading-none">{shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
