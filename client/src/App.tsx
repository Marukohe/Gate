import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { ServerDialog } from '@/components/server/ServerDialog';
import { PlanModeOverlay } from '@/components/plan-mode/PlanModeOverlay';
import { useServerStore, type Server } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useChatStore } from '@/stores/chat-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand } = useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.ok ? r.json() : [])
      .then((servers: any[]) => {
        setServers(servers);
        // Clear persisted activeServerId if the server no longer exists
        const current = useServerStore.getState().activeServerId;
        if (current && !servers.find((s) => s.id === current)) {
          setActiveServer(null);
        }
      })
      .catch(() => {});
  }, [setServers, setActiveServer]);

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

    // Direct bash command: !command prefix
    if (text.startsWith('!')) {
      const command = text.slice(1).trim();
      if (command) {
        execCommand(activeServerId, activeSessionId, command);
        return;
      }
    }

    sendInput(activeServerId, activeSessionId, text);
  }, [activeServerId, activeSessionId, sendInput, addMessage, execCommand]);

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
            onListBranches={listBranches}
            onSwitchBranch={switchBranch}
          />
        }
        onAddServer={() => { setEditingServer(null); setServerDialogOpen(true); }}
        onEditServer={(server) => { setEditingServer(server); setServerDialogOpen(true); }}
        onSendToChat={handleSend}
      />
      <ServerDialog
        open={serverDialogOpen}
        onOpenChange={(open) => { setServerDialogOpen(open); if (!open) setEditingServer(null); }}
        editServer={editingServer}
      />
      <PlanModeOverlay onSendInput={handleSend} />
    </>
  );
}

export default App;
