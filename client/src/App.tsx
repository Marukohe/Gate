import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { ServerDialog } from '@/components/server/ServerDialog';
import { CreateSessionDialog } from '@/components/chat/CreateSessionDialog';
import { CommandCenter } from '@/components/home/CommandCenter';
import { WorkspaceHome } from '@/components/workspace/WorkspaceHome';
import type { WorkspaceStartOptions } from '@/components/workspace/WorkspaceStart';
import { AddWorkspaceDialog } from '@/components/workspace/AddWorkspaceDialog';
import { useServerStore, type Server } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useChatStore } from '@/stores/chat-store';
import { usePlanStore } from '@/stores/plan-store';
import { useUIStore } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  // Sync dark mode class on <html>
  const darkMode = useUIStore((s) => s.darkMode);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    // Sync theme-color meta to avoid iOS PWA status bar flash on input method switch
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', darkMode ? '#0f172a' : '#ffffff');
  }, [darkMode]);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand, syncTranscript, listCliSessions, listClaudeSessions, loadMoreMessages, listCheckpoints, listWorkspaces, startWorkspaceTask } = useWebSocket();

  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  type Route = { kind: 'home' } | { kind: 'workspace'; id: string } | { kind: 'session'; serverId: string; sessionId: string };
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const enterHome = useCallback(() => {
    setActiveWorkspace(null);
    setRoute({ kind: 'home' });
  }, [setActiveWorkspace]);
  const enterWorkspace = useCallback((id: string) => setRoute({ kind: 'workspace', id }), []);
  const enterSession = useCallback(
    (serverId: string, sessionId: string) => setRoute({ kind: 'session', serverId, sessionId }),
    [],
  );

  useEffect(() => {
    const handleStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string; sessionId?: string; workspaceId?: string | null }>).detail;
      if (!detail?.serverId || !detail.sessionId) return;
      setActiveServer(detail.serverId);
      setActiveSession(detail.serverId, detail.sessionId);
      if (detail.workspaceId) setActiveWorkspace(detail.workspaceId);
      enterSession(detail.serverId, detail.sessionId);
    };
    window.addEventListener('gate:workspace-task-started', handleStarted);
    return () => window.removeEventListener('gate:workspace-task-started', handleStarted);
  }, [setActiveServer, setActiveSession, setActiveWorkspace, enterSession]);

  // Reset route to home when the routed-to session or workspace is removed from its store.
  // Without this, a workspace deletion that cascades the active session leaves ChatView
  // rendering an empty inert pane.
  const allSessions = useSessionStore((s) => s.sessions);
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces);
  useEffect(() => {
    if (route.kind === 'session') {
      const list = allSessions[route.serverId] ?? [];
      if (!list.find((s) => s.id === route.sessionId)) {
        setRoute({ kind: 'home' });
      }
    } else if (route.kind === 'workspace') {
      if (!allWorkspaces[route.id]) {
        setRoute({ kind: 'home' });
      }
    }
  }, [route, allSessions, allWorkspaces]);

  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createCtx, setCreateCtx] = useState<{ workspaceId: string; repoPath: string } | null>(null);

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

  // Fetch workspaces over WS on mount and refresh periodically
  useEffect(() => {
    listWorkspaces();
    const interval = setInterval(() => listWorkspaces(), 30_000);
    return () => clearInterval(interval);
  }, [listWorkspaces]);

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
        }
        // No auto-create: empty workspaces show "New session" affordance instead.
      })
      .catch(() => {});

    return () => {
      controller.abort();
      // Reset so aborted fetches can retry (e.g. React StrictMode double-mount)
      prevServerRef.current = null;
    };
  }, [activeServerId, setSessions, setActiveSession]);

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
    listCheckpoints(activeServerId, activeSessionId);
  }, [activeServerId, activeSessionId, connectToSession, listCheckpoints]);

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

  const handleCreateSession = useCallback((name: string, workingDir: string | null, claudeSessionId?: string | null, provider?: string) => {
    if (!activeServerId) return;
    createSession(activeServerId, name, workingDir, claudeSessionId, provider);
  }, [activeServerId, createSession]);

  const clearDeletedSessionState = useCallback((sessionId: string) => {
    useChatStore.getState().clearMessages(sessionId);
    const planState = usePlanStore.getState();
    const planId = planState.autoExtractedPlanIds[sessionId];
    if (planId && planState.activePlanId === planId) planState.setActivePlan(null);
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    deleteSession(activeServerId, sessionId);
    clearDeletedSessionState(sessionId);
  }, [activeServerId, deleteSession, clearDeletedSessionState]);

  const handleDeleteSessionFromSidebar = useCallback((serverId: string, sessionId: string) => {
    deleteSession(serverId, sessionId);
    clearDeletedSessionState(sessionId);
  }, [deleteSession, clearDeletedSessionState]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    if (sessionId === activeSessionId) {
      // Already selected — force reconnect if not connected
      connectToSession(activeServerId, sessionId);
      return;
    }
    setActiveSession(activeServerId, sessionId);
  }, [activeServerId, activeSessionId, setActiveSession, connectToSession]);

  // Workspace rows open the board; session rows open chat. This keeps the
  // overall workspace view reachable without a refresh.
  const handleSelectWorkspace = useCallback((id: string) => {
    const workspace = workspaces[id];
    if (!workspace) return;
    setActiveWorkspace(id);
    setActiveServer(workspace.serverId);
    enterWorkspace(id);
  }, [workspaces, setActiveWorkspace, setActiveServer, enterWorkspace]);

  // Sidebar / Workspace Home / Command Center can all open a session: route to chat
  // and connect, also setting active workspace if the session is linked to one.
  const handleSidebarSelectSession = useCallback((serverId: string, sessionId: string) => {
    const session = useSessionStore.getState().sessions[serverId]?.find((s) => s.id === sessionId);
    setActiveServer(serverId);
    setActiveSession(serverId, sessionId);
    if (session?.workspaceId) setActiveWorkspace(session.workspaceId);
    connectToSession(serverId, sessionId);
    enterSession(serverId, sessionId);
  }, [setActiveServer, setActiveSession, setActiveWorkspace, connectToSession, enterSession]);

  const handleNewSessionInWorkspace = useCallback((workspaceId: string) => {
    const ws = useWorkspaceStore.getState().workspaces[workspaceId];
    if (!ws) return;
    setActiveServer(ws.serverId);
    setCreateCtx({ workspaceId, repoPath: ws.repoPath });
    setCreateOpen(true);
  }, [setActiveServer]);

  const handleStartWorkspaceTask = useCallback((workspaceId: string, goal: string, options: WorkspaceStartOptions) => {
    startWorkspaceTask(workspaceId, goal, options);
  }, [startWorkspaceTask]);

  const handleCreateSessionFromDialog = useCallback((name: string, workingDir: string | null, claudeSessionId?: string | null, provider?: string) => {
    if (!activeServerId) return;
    // Pass workspaceId so the server links the new session immediately rather than
    // waiting for the lazy probe-on-connect path (which would show the session under
    // the Loose footer until the user clicked it for the first time).
    createSession(activeServerId, name, workingDir, claudeSessionId, provider, createCtx?.workspaceId);
    setCreateOpen(false);
  }, [activeServerId, createSession, createCtx]);

  const handleSyncTranscript = useCallback((sessionId: string) => {
    if (!activeServerId) return;
    syncTranscript(activeServerId, sessionId);
  }, [activeServerId, syncTranscript]);

  const handleLoadMore = useCallback((beforeTimestamp: number) => {
    if (!activeServerId || !activeSessionId) return;
    loadMoreMessages(activeServerId, activeSessionId, beforeTimestamp);
  }, [activeServerId, activeSessionId, loadMoreMessages]);

  const mainView = (() => {
    if (route.kind === 'session') {
      return (
        <ChatView
          onSend={handleSend}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          onListBranches={listBranches}
          onSwitchBranch={switchBranch}
          onSyncTranscript={handleSyncTranscript}
          onListClaudeSessions={listClaudeSessions}
          onListCliSessions={listCliSessions}
          onSendToSession={handleSendToSession}
          onLoadMore={handleLoadMore}
          onOpenWorkspace={handleSelectWorkspace}
        />
      );
    }
    if (route.kind === 'workspace') {
      return (
        <WorkspaceHome
          workspaceId={route.id}
          onNewSession={() => handleNewSessionInWorkspace(route.id)}
          onStartTask={handleStartWorkspaceTask}
          onSelectSession={handleSidebarSelectSession}
        />
      );
    }
    return (
      <CommandCenter
        onAddWorkspace={() => setAddWorkspaceOpen(true)}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectSession={handleSidebarSelectSession}
      />
    );
  })();
  const inspectorWorkspaceId = route.kind === 'workspace'
    ? route.id
    : route.kind === 'session'
      ? allSessions[route.serverId]?.find((session) => session.id === route.sessionId)?.workspaceId ?? null
      : null;

  return (
    <>
      <AppShell
        mainView={mainView}
        onAddServer={() => { setEditingServer(null); setServerDialogOpen(true); }}
        onEditServer={(server) => { setEditingServer(server); setServerDialogOpen(true); }}
        onSendToChat={handleSend}
        onOpenHome={enterHome}
        onSelectSession={handleSidebarSelectSession}
        onSelectWorkspace={handleSelectWorkspace}
        onDeleteSession={handleDeleteSessionFromSidebar}
        onAddWorkspace={() => setAddWorkspaceOpen(true)}
        inspectorWorkspaceId={inspectorWorkspaceId}
      />
      <ServerDialog
        open={serverDialogOpen}
        onOpenChange={(open) => { setServerDialogOpen(open); if (!open) setEditingServer(null); }}
        editServer={editingServer}
      />
      <AddWorkspaceDialog open={addWorkspaceOpen} onOpenChange={setAddWorkspaceOpen} />
      {activeServerId && (
        <CreateSessionDialog
          open={createOpen}
          onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateCtx(null); }}
          onSubmit={handleCreateSessionFromDialog}
          defaultName="Default"
          defaultWorkingDir={createCtx?.repoPath}
          serverId={activeServerId}
          workspaceContext={createCtx}
          onListClaudeSessions={listClaudeSessions}
          onListCliSessions={listCliSessions}
        />
      )}
      <Toaster position="top-right" theme={darkMode ? 'dark' : 'light'} richColors />
    </>
  );
}

export default App;
