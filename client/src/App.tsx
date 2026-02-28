import { useState, useEffect, useCallback, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { ServerDialog } from '@/components/server/ServerDialog';
import { useServerStore, type Server } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useChatStore } from '@/stores/chat-store';
import { usePlanStore } from '@/stores/plan-store';
import { useUIStore } from '@/stores/ui-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  // Sync dark mode class on <html>
  const darkMode = useUIStore((s) => s.darkMode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand, syncTranscript, listClaudeSessions, loadMoreMessages } = useWebSocket();

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

  // Fetch sessions when server changes, auto-select first session.
  // AbortController cancels stale fetches on rapid server switching.
  const prevServerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeServerId) return;
    if (activeServerId === prevServerRef.current) return;
    prevServerRef.current = activeServerId;

    const controller = new AbortController();
    const serverId = activeServerId;

    fetch(`/api/servers/${serverId}/sessions`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : [])
      .then((sessionList: any[]) => {
        // Guard: discard if user already switched to another server
        if (useServerStore.getState().activeServerId !== serverId) return;
        setSessions(serverId, sessionList);
        if (sessionList.length > 0) {
          // Keep persisted session if it still exists, otherwise pick first
          const persisted = useSessionStore.getState().activeSessionId[serverId];
          if (!persisted || !sessionList.find((s: any) => s.id === persisted)) {
            setActiveSession(serverId, sessionList[0].id);
          }
        } else {
          createSession(serverId, 'Default');
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
      // Reset so aborted fetches can retry (e.g. React StrictMode double-mount)
      prevServerRef.current = null;
    };
  }, [activeServerId, setSessions, setActiveSession, createSession]);

  // Evict messages for other servers' sessions to save memory.
  // Messages will be reloaded from DB when switching back.
  useEffect(() => {
    if (!activeServerId) return;
    const currentSessions = useSessionStore.getState().sessions[activeServerId] ?? [];
    const keepIds = new Set(currentSessions.map((s) => s.id));
    useChatStore.getState().clearServerMessages(keepIds);
  }, [activeServerId]);

  // Auto-select newly created session (from WS 'session-created' event)
  const sessions = useSessionStore((s) => activeServerId ? s.sessions[activeServerId] : undefined);
  useEffect(() => {
    if (!activeServerId || !sessions || sessions.length === 0) return;
    const currentActive = useSessionStore.getState().activeSessionId[activeServerId];
    if (!currentActive || !sessions.find((s) => s.id === currentActive)) {
      setActiveSession(activeServerId, sessions[0].id);
    }
  }, [activeServerId, sessions, setActiveSession]);

  // Connect when activeSessionId changes (onopen handles WS-not-ready case)
  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    connectToSession(activeServerId, activeSessionId);
  }, [activeServerId, activeSessionId, connectToSession]);

  // Fetch git info immediately and refresh periodically
  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    fetchGitInfo(activeServerId, activeSessionId);
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

  // Explicit session-targeted send — used by plan mode to avoid stale activeSessionId
  const handleSendToSession = useCallback((text: string, serverId: string, sessionId: string) => {
    addMessage(sessionId, { type: 'user', content: text, timestamp: Date.now() });
    sendInput(serverId, sessionId, text);
  }, [sendInput, addMessage]);

  const handleCreateSession = useCallback((name: string, workingDir: string | null, claudeSessionId?: string | null) => {
    if (!activeServerId) return;
    createSession(activeServerId, name, workingDir, claudeSessionId);
  }, [activeServerId, createSession]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    deleteSession(activeServerId, sessionId);
    // Clean up associated store data
    useChatStore.getState().clearMessages(sessionId);
    const planState = usePlanStore.getState();
    const planId = planState.autoExtractedPlanIds[sessionId];
    if (planId && planState.activePlanId === planId) planState.setActivePlan(null);
  }, [activeServerId, deleteSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    if (sessionId === activeSessionId) {
      // Already selected — force reconnect if not connected
      connectToSession(activeServerId, sessionId);
      return;
    }
    setActiveSession(activeServerId, sessionId);
  }, [activeServerId, activeSessionId, setActiveSession, connectToSession]);

  const handleSyncTranscript = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    syncTranscript(activeServerId, sessionId);
  }, [activeServerId, syncTranscript]);

  const handleLoadMore = useCallback((beforeTimestamp: number) => {
    if (!activeServerId || !activeSessionId) return;
    loadMoreMessages(activeServerId, activeSessionId, beforeTimestamp);
  }, [activeServerId, activeSessionId, loadMoreMessages]);

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
            onSyncTranscript={handleSyncTranscript}
            onListClaudeSessions={listClaudeSessions}
            onSendToSession={handleSendToSession}
            onLoadMore={handleLoadMore}
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
    </>
  );
}

export default App;
