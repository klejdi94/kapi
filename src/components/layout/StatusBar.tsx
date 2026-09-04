import { PanelLeft, Rows3, Columns3, ShieldCheck } from 'lucide-react';
import { useSession, type SplitLayout } from '@/store/session';
import { IconButton } from '@/components/ui/primitives';
import { estimateDiskUsageBytes, dataDirectoryPath } from '@/lib/fileStorage';
import { formatBytes } from '@/lib/format';
import { useEffect, useState } from 'react';

export function StatusBar() {
  const sidebarOpen = useSession((s) => s.sidebarOpen);
  const setSession = useSession((s) => s.set);
  const splitLayout = useSession((s) => s.splitLayout);
  const [storage, setStorage] = useState(0);
  const [dataDir, setDataDir] = useState('');

  useEffect(() => {
    const update = () => estimateDiskUsageBytes().then(setStorage);
    update();
    const id = setInterval(update, 4000);
    dataDirectoryPath().then(setDataDir);
    return () => clearInterval(id);
  }, []);

  const toggleLayout = (v: SplitLayout) => setSession('splitLayout', v);

  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-2 text-[10.5px] text-faint">
      <IconButton label="Toggle sidebar (⌘\\)" active={sidebarOpen} onClick={() => setSession('sidebarOpen', !sidebarOpen)} className="h-5 w-5">
        <PanelLeft size={12} />
      </IconButton>
      <div className="flex items-center gap-0.5">
        <IconButton label="Split left/right" active={splitLayout === 'horizontal'} onClick={() => toggleLayout('horizontal')} className="h-5 w-5">
          <Columns3 size={12} />
        </IconButton>
        <IconButton label="Split top/bottom" active={splitLayout === 'vertical'} onClick={() => toggleLayout('vertical')} className="h-5 w-5">
          <Rows3 size={12} />
        </IconButton>
      </div>
      <span className="flex-1" />
      <span title={dataDir ? `Stored at ${dataDir}` : 'Everything is stored only on this machine'}>{formatBytes(storage)} used locally</span>
      <span className="flex items-center gap-1" title="Requests go straight from your machine to the API — kapi has no backend of its own">
        <ShieldCheck size={11} /> nothing stored on a server
      </span>
    </div>
  );
}
