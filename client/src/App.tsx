import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { ServerDialog } from '@/components/server/ServerDialog';
import { PlanModeOverlay } from '@/components/plan-mode/PlanModeOverlay';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useChatStore } from '@/stores/chat-store';
import { usePlanStore } from '@/stores/plan-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { parseMarkdownChecklist } from '@/lib/plan-parser';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);

  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const addPlan = usePlanStore((s) => s.addPlan);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  const { connectToSession, sendInput, createSession, deleteSession } = useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.ok ? r.json() : [])
      .then(setServers)
      .catch(() => {});
  }, [setServers]);

  // Fetch sessions when server changes, auto-select first session
  const prevServerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeServerId) return;
    if (activeServerId === prevServerRef.current) return;
    prevServerRef.current = activeServerId;

    fetch(`/api/servers/${activeServerId}/sessions`)
      .then((r) => r.ok ? r.json() : [])
      .then((sessionList: any[]) => {
        setSessions(activeServerId, sessionList);
        if (sessionList.length > 0) {
          setActiveSession(activeServerId, sessionList[0].id);
        } else {
          createSession(activeServerId, 'Default');
        }
      })
      .catch(() => {});
  }, [activeServerId, setSessions, setActiveSession, createSession]);

  // Auto-select newly created session (from WS 'session-created' event)
  const sessions = useSessionStore((s) => activeServerId ? s.sessions[activeServerId] : undefined);
  useEffect(() => {
    if (!activeServerId || !sessions || sessions.length === 0) return;
    const currentActive = useSessionStore.getState().activeSessionId[activeServerId];
    if (!currentActive || !sessions.find((s) => s.id === currentActive)) {
      setActiveSession(activeServerId, sessions[0].id);
    }
  }, [activeServerId, sessions, setActiveSession]);

  // Connect when activeSessionId changes
  const prevSessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    if (activeSessionId === prevSessionRef.current) return;
    prevSessionRef.current = activeSessionId;
    connectToSession(activeServerId, activeSessionId);
  }, [activeServerId, activeSessionId, connectToSession]);

  const addMessage = useChatStore((s) => s.addMessage);

  const handleSend = useCallback((text: string) => {
    if (!activeServerId || !activeSessionId) return;
    addMessage(activeSessionId, { type: 'user', content: text, timestamp: Date.now() });
    sendInput(activeServerId, activeSessionId, text);
  }, [activeServerId, activeSessionId, sendInput, addMessage]);

  const handleExtractPlan = useCallback((content: string) => {
    if (!activeSessionId) return;
    const { title, steps } = parseMarkdownChecklist(content);
    const plan = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      title,
      content,
      steps,
      status: 'active' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addPlan(activeSessionId, plan);
    setActivePlan(plan.id);
  }, [activeSessionId, addPlan, setActivePlan]);

  const handleCreateSession = useCallback((name: string) => {
    if (!activeServerId) return;
    createSession(activeServerId, name);
  }, [activeServerId, createSession]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    deleteSession(activeServerId, sessionId);
  }, [activeServerId, deleteSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    setActiveSession(activeServerId, sessionId);
  }, [activeServerId, setActiveSession]);

  return (
    <>
      <AppShell
        chatView={
          <ChatView
            onSend={handleSend}
            onExtractPlan={handleExtractPlan}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onSelectSession={handleSelectSession}
          />
        }
        planPanel={<PlanPanel onSendToChat={handleSend} />}
        onAddServer={() => setServerDialogOpen(true)}
      />
      <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
      <PlanModeOverlay onSendInput={handleSend} />
    </>
  );
}

export default App;
