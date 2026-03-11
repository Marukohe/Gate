import { useSessionStore } from '../../stores/session-store';
import { useServerStore } from '../../stores/server-store';
import { useWebSocket } from '../../hooks/use-websocket';

const providers = [
  { name: 'claude', label: 'Claude' },
  { name: 'codex', label: 'Codex' },
];

export function ProviderSwitcher() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const sessions = useSessionStore((s) => activeServerId ? s.sessions[activeServerId] : undefined);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const activeSession = sessions?.find((s) => s.id === activeSessionId);
  const { switchProvider } = useWebSocket();

  if (!activeSession || !activeServerId) return null;

  const handleSwitch = (provider: string) => {
    if (provider === (activeSession.provider ?? 'claude')) return;
    switchProvider(activeServerId, activeSession.id, provider);
  };

  return (
    <select
      value={activeSession.provider ?? 'claude'}
      onChange={(e) => handleSwitch(e.target.value)}
      className="h-7 rounded border border-border bg-background px-2 text-xs"
    >
      {providers.map((p) => (
        <option key={p.name} value={p.name}>{p.label}</option>
      ))}
    </select>
  );
}
