import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { ServerDialog } from '@/components/server/ServerDialog';
import { PlanModeOverlay } from '@/components/plan-mode/PlanModeOverlay';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useChatStore } from '@/stores/chat-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);

  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo } = useWebSocket();

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

  // Periodically refresh git info for the active session
  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    const interval = setInterval(() => {
      fetchGitInfo(activeServerId, activeSessionId);
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeServerId, activeSessionId, fetchGitInfo]);

  const addMessage = useChatStore((s) => s.addMessage);

  const handleSend = useCallback((text: string) => {
    if (!activeServerId || !activeSessionId) return;
    addMessage(activeSessionId, { type: 'user', content: text, timestamp: Date.now() });
    sendInput(activeServerId, activeSessionId, text);
  }, [activeServerId, activeSessionId, sendInput, addMessage]);

  const handleCreateSession = useCallback((name: string, workingDir: string | null) => {
    if (!activeServerId) return;
    createSession(activeServerId, name, workingDir);
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
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onSelectSession={handleSelectSession}
          />
        }
        onAddServer={() => setServerDialogOpen(true)}
      />
      <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
      <PlanModeOverlay onSendInput={handleSend} />
    </>
  );
}

export default App;
