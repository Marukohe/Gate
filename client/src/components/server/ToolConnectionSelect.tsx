import { ChevronDown } from 'lucide-react';
import type { MonitorServer } from '../../../../server/src/types';
import { connectionLabel } from '@/lib/server-groups';

export function ToolConnectionSelect({ connections, value, onChange, disabled }: {
  connections: MonitorServer[]; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  return <label className="block space-y-1 text-sm">Tool<span className="relative block">
    <select aria-label="Tool" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full min-w-0 appearance-none rounded-md border bg-background pl-3 pr-9 disabled:opacity-60">
      {connections.map((connection) => <option key={connection.id} value={connection.id}>{connectionLabel(connection, connections)}</option>)}
    </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  </span></label>;
}
