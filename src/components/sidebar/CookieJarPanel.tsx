import { Cookie, Trash2 } from 'lucide-react';
import { EmptyState, IconButton, Button } from '@/components/ui/primitives';
import { useActiveWorkspace, useWorkspaces } from '@/store/workspaces';
import { confirmAction } from '@/lib/confirm';

/** Cookies picked up from `Set-Cookie` responses and sent back automatically to matching hosts — a small, inspectable browser-style jar, scoped to this workspace. */
export function CookieJarPanel() {
  const workspace = useActiveWorkspace();
  const deleteCookie = useWorkspaces((s) => s.deleteCookie);
  const clearCookies = useWorkspaces((s) => s.clearCookies);
  const cookies = workspace.cookies ?? [];

  const clearAll = async () => {
    if (!(await confirmAction(`Clear all ${cookies.length} cookies in this workspace?`, { okLabel: 'Clear', danger: true }))) return;
    clearCookies();
  };

  if (!cookies.length) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={<Cookie size={22} />}
          title="No cookies yet"
          detail="Cookies a response sets show up here and are sent back automatically to matching hosts — like a browser tab."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
        <span className="text-[11px] text-faint">
          {cookies.length} cookie{cookies.length === 1 ? '' : 's'}
        </span>
        <Button size="sm" onClick={clearAll}>
          <Trash2 size={11} /> Clear all
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wider text-faint">
              {['Name', 'Value', 'Domain', 'Path', 'Expires', 'Flags', ''].map((h) => (
                <th key={h} className="border-b border-line px-2.5 py-1.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cookies.map((c) => (
              <tr key={`${c.name}|${c.domain}|${c.path}`} className="group align-top">
                <td className="border-b border-line px-2.5 py-1.5 font-mono font-medium text-fg">{c.name}</td>
                <td className="max-w-[160px] truncate border-b border-line px-2.5 py-1.5 font-mono text-dim" title={c.value}>
                  {c.value}
                </td>
                <td className="border-b border-line px-2.5 py-1.5 text-dim">{c.domain}</td>
                <td className="border-b border-line px-2.5 py-1.5 text-dim">{c.path}</td>
                <td className="border-b border-line px-2.5 py-1.5 text-dim">{c.expires ? new Date(c.expires).toLocaleString() : 'Session'}</td>
                <td className="border-b border-line px-2.5 py-1.5 text-faint">{[c.httpOnly && 'HttpOnly', c.secure && 'Secure'].filter(Boolean).join(', ') || '—'}</td>
                <td className="border-b border-line px-1 py-1.5">
                  <IconButton label="Delete cookie" tone="danger" className="opacity-0 group-hover:opacity-100" onClick={() => deleteCookie(c.name, c.domain, c.path)}>
                    <Trash2 size={11} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
