import { useServerStore } from '@/stores/server-store';

export function TopBar() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);

  return (
    <div className="flex h-10 items-center border-b px-4 lg:hidden">
      <span className="text-sm font-medium">{activeServer?.name ?? 'CodingEverywhere'}</span>
    </div>
  );
}
