import { FolderTree, GitBranch, History, Layers, Server } from 'lucide-react';
import { useSession, type SidebarPanel } from '@/store/session';

const ITEMS: { value: SidebarPanel; label: string; icon: typeof FolderTree }[] = [
  { value: 'collections', label: 'Collections', icon: FolderTree },
  { value: 'environments', label: 'Environments', icon: Layers },
  { value: 'history', label: 'History', icon: History },
  { value: 'git', label: 'Git', icon: GitBranch },
  { value: 'mock', label: 'Mock Servers', icon: Server },
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
    <div className="flex w-13 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-2 py-2">
      {ITEMS.map(({ value, label, icon: Icon }) => {
        const active = sidebarOpen && panel === value;
        return (
          <button
            key={value}
            onClick={() => select(value)}
            title={label}
            className={`flex w-11 flex-col items-center gap-1 rounded-md py-1.5 text-[9.5px] transition-colors ${
              active ? 'bg-accent/15 text-accent' : 'text-faint hover:bg-surface-3 hover:text-fg'
            }`}
          >
            <Icon size={17} />
            <span className="leading-none">{label.split(' ')[0]}</span>
          </button>
        );
      })}
    </div>
  );
}
