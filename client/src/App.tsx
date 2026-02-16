import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ServerDialog } from '@/components/server/ServerDialog';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);

  useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then(setServers)
      .catch(console.error);
  }, [setServers]);

  return (
    <>
      <AppShell
        chatView={
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select a server to start
          </div>
        }
        planPanel={
          <div className="flex h-full items-center justify-center text-muted-foreground p-4">
            No active plan
          </div>
        }
        onAddServer={() => setServerDialogOpen(true)}
      />
      <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
    </>
  );
}

export default App;
