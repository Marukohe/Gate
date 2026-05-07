import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, GitBranch, Loader2, Play, Send, SquareTerminal, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChangesPanel } from '@/components/changes/ChangesPanel';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { WorkspaceActionBar } from './WorkspaceActionBar';
import { useSessionStore, type Session } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useWebSocket } from '@/hooks/use-websocket';

interface WorkspaceInspectorProps {
  workspaceId: string;
  onSendToChat: (text: string) => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
}

function pickPrimarySession(workspaceId: string, primarySessionId: string | null, sessions: Session[]): Session | null {
  const visible = sessions.filter((session) => session.workspaceId === workspaceId && !session.isHidden);
  return visible.find((session) => session.id === primarySessionId)
    ?? [...visible].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
    ?? null;
}

export function WorkspaceInspector({ workspaceId, onSendToChat, onSelectSession }: WorkspaceInspectorProps) {
  const workspace = useWorkspaceStore((s) => s.workspaces[workspaceId]);
  const snapshot = useWorkspaceStore((s) => s.inspectors[workspaceId]);
  const runResult = useWorkspaceStore((s) => s.runResults[workspaceId]);
  const terminalEntries = useWorkspaceStore((s) => s.terminalEntries[workspaceId] ?? []);
  const clearTerminal = useWorkspaceStore((s) => s.clearTerminal);
  const sessionsByServer = useSessionStore((s) => s.sessions);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const { fetchWorkspaceInspector, runWorkspaceScript, execTerminalCommand } = useWebSocket();
  const [terminalCommand, setTerminalCommand] = useState('');
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchWorkspaceInspector(workspaceId);
  }, [fetchWorkspaceInspector, workspaceId]);

  const localSessions = useMemo(() => {
    const out: Session[] = [];
    for (const list of Object.values(sessionsByServer)) out.push(...list);
    return out;
  }, [sessionsByServer]);

  const primarySession = snapshot?.primarySession
    ?? (workspace ? pickPrimarySession(workspace.id, workspace.primarySessionId, localSessions) : null);
  const actionSessions = snapshot?.actionSessions
    ?? localSessions.filter((session) => session.workspaceId === workspaceId && session.isHidden);
  const targetServerId = primarySession?.serverId ?? workspace?.serverId ?? null;
  const targetSessionId = primarySession?.id ?? null;
  const branch = targetSessionId ? gitInfo[targetSessionId]?.branch : null;
  const worktree = targetSessionId ? gitInfo[targetSessionId]?.worktree : null;
  const terminalReady = Boolean(targetServerId && targetSessionId);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ block: 'end' });
  }, [terminalEntries]);

  function submitTerminalCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetServerId || !targetSessionId || !terminalCommand.trim()) return;
    execTerminalCommand(targetServerId, targetSessionId, workspaceId, terminalCommand);
    setTerminalCommand('');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="border-b px-3 py-2">
        <div className="truncate text-xs font-semibold">{workspace?.name ?? 'Workspace'}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {branch && (
            <span className="flex min-w-0 items-center gap-1">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          )}
          {worktree && <span className="truncate font-mono">{worktree}</span>}
        </div>
      </div>

      <WorkspaceActionBar workspaceId={workspaceId} branch={branch} provider={primarySession?.provider} />

      <Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-2 mt-2 grid grid-cols-4">
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>

        <TabsContent value="changes" className="min-h-0 flex-1 overflow-hidden">
          <ChangesPanel serverId={targetServerId} sessionId={targetSessionId} onOpenDiffSession={onSelectSession} />
        </TabsContent>
        <TabsContent value="plan" className="min-h-0 flex-1 overflow-hidden">
          <PlanPanel onSendToChat={onSendToChat} sessionId={targetSessionId} />
        </TabsContent>
        <TabsContent value="run" className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Play className="h-3.5 w-3.5" />
            Run
          </div>
          {snapshot?.scripts && Object.keys(snapshot.scripts).length > 0 ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-1.5">
                {(['setup', 'run', 'test'] as const).map((name) => (
                  <Button
                    key={name}
                    variant="outline"
                    size="sm"
                    disabled={!snapshot.scripts[name] || runResult?.status === 'running'}
                    onClick={() => runWorkspaceScript(workspaceId, name)}
                    className="h-8 text-xs"
                  >
                    {runResult?.status === 'running' && runResult.scriptName === name ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : name}
                  </Button>
                ))}
              </div>
              {runResult && (
                <div className="space-y-2">
                  <div className="text-[11px] text-muted-foreground">
                    {runResult.scriptName} · {runResult.status}
                    {runResult.error ? ` · ${runResult.error}` : ''}
                  </div>
                  {runResult.urls.length > 0 && (
                    <div className="space-y-1">
                      {runResult.urls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-w-0 items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{url}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {runResult.output && (
                    <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                      {runResult.output}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              No scripts configured
            </div>
          )}
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
                <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Terminal</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={terminalEntries.length === 0}
                onClick={() => clearTerminal(workspaceId)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {terminalEntries.length === 0 ? (
                <div className="rounded border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                  {terminalReady ? 'Run a command in the workspace checkout.' : 'Open a workspace session to use Terminal.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {terminalEntries.map((entry) => {
                    const hasOutput = entry.stdout || entry.stderr || entry.error;
                    return (
                      <div key={entry.id} className="rounded-md border bg-card">
                        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
                          <code className="min-w-0 truncate text-[11px] font-semibold">$ {entry.command}</code>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {entry.status === 'running' ? 'running' : `exit ${entry.exitCode ?? '?'}`}
                          </span>
                        </div>
                        {hasOutput ? (
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-2 py-2 text-[11px] leading-relaxed">
                            {entry.stdout}
                            {entry.stderr ? `${entry.stdout ? '\n' : ''}${entry.stderr}` : ''}
                            {entry.error ? `${entry.stdout || entry.stderr ? '\n' : ''}${entry.error}` : ''}
                          </pre>
                        ) : (
                          <div className="px-2 py-3 text-[11px] text-muted-foreground">
                            {entry.status === 'running' ? 'Waiting for output...' : '(no output)'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={terminalEndRef} />
                </div>
              )}
            </div>

            <form className="flex items-center gap-2 border-t p-2" onSubmit={submitTerminalCommand}>
              <span className="pl-1 font-mono text-xs text-muted-foreground">$</span>
              <Input
                value={terminalCommand}
                onChange={(event) => setTerminalCommand(event.target.value)}
                disabled={!terminalReady}
                placeholder={terminalReady ? 'git status' : 'No session connected'}
                className="h-8 font-mono text-xs"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!terminalReady || !terminalCommand.trim()}
                className="h-8 px-2"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>

      {actionSessions.length > 0 && (
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          {actionSessions.length} action session{actionSessions.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}
