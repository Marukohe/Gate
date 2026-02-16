import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { ServerDialog } from '@/components/server/ServerDialog';
import { useServerStore } from '@/stores/server-store';
import { useChatStore } from '@/stores/chat-store';
import { usePlanStore } from '@/stores/plan-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { parseMarkdownChecklist } from '@/lib/plan-parser';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeServerStatus = useServerStore((s) => s.activeServerId ? s.connectionStatus[s.activeServerId] : undefined);
  const addMessage = useChatStore((s) => s.addMessage);
  const addPlan = usePlanStore((s) => s.addPlan);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  const { connectToServer, sendInput } = useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then(setServers)
      .catch(console.error);
  }, [setServers]);

  // Auto-connect when selecting a server
  useEffect(() => {
    if (activeServerId && activeServerStatus !== 'connected' && activeServerStatus !== 'connecting') {
      connectToServer(activeServerId);
    }
  }, [activeServerId, activeServerStatus, connectToServer]);

  const handleSend = useCallback((text: string) => {
    if (!activeServerId) return;

    addMessage(activeServerId, {
      id: crypto.randomUUID(),
      type: 'user',
      content: text,
      timestamp: Date.now(),
    });

    sendInput(activeServerId, text);
  }, [activeServerId, addMessage, sendInput]);

  const handleExtractPlan = useCallback((content: string) => {
    if (!activeServerId) return;
    const { title, steps } = parseMarkdownChecklist(content);
    const plan = {
      id: crypto.randomUUID(),
      sessionId: activeServerId,
      title,
      content,
      steps,
      status: 'active' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addPlan(activeServerId, plan);
    setActivePlan(plan.id);
  }, [activeServerId, addPlan, setActivePlan]);

  return (
    <>
      <AppShell
        chatView={<ChatView onSend={handleSend} onExtractPlan={handleExtractPlan} />}
        planPanel={<PlanPanel onSendToChat={handleSend} />}
        onAddServer={() => setServerDialogOpen(true)}
      />
      <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
    </>
  );
}

export default App;
