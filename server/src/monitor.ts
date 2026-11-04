import type { Database } from './db.js';
import type { SSHManager } from './ssh-manager.js';

import type { MonitoredSession, MonitorSnapshot, SessionState } from './monitor-types.js';
import type { DiscoveryResult } from './session-discovery.js';

const compact = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);
const hookActivity: Record<string, string> = { SessionStart: 'Session started', UserPromptSubmit: 'Working on a request',
  PreToolUse: 'Using a tool', PostToolUse: 'Tool finished', PermissionRequest: 'Waiting for approval',
  Stop: 'Last turn finished', SessionEnd: 'Session ended' };
const rank: Record<SessionState, number> = { waiting: 0, failed: 1, running: 2, unknown: 3, idle: 4, completed: 5, stopped: 6 };

// Project cached evidence only; background discovery owns its separate read-only SSH connections.
export function monitorSnapshot(db: Database, ssh: Pick<SSHManager, 'hasActiveChannel'>, now = Date.now(),
  discovery: Map<string, DiscoveryResult> = new Map()): MonitorSnapshot {
  const snapshot = db.workbench.monitorRecords();
  const checkouts = new Map(snapshot.checkouts.map((item) => [item.id, item]));
  const tasks = new Map(snapshot.tasks.map((item) => [item.id, item]));
  const servers: MonitorSnapshot['servers'] = db.listServers().map(({ id, name, host, port, username }) => ({
    id, name, host, port, username, sessions: [] as MonitoredSession[],
  }));
  const byServer = new Map(servers.map((server) => [server.id, server]));
  for (const server of servers) {
    for (const session of db.listSessions(server.id)) {
      if (session.isHidden) continue;
      const messages = db.getSessionActivity(session.id, session.chatStartedAt ?? 0)
        .filter((message) => !message.provider || message.provider === session.provider);
      const latest = messages.at(-1);
      const marker = [...messages].reverse().find((message) => message.type === 'user' ||
        (message.type === 'system' && ['result', 'error'].includes(message.subType ?? '')));
      const connected = ssh.hasActiveChannel(server.id, session.id);
      let state: SessionState = connected ? 'running' : 'unknown';
      if (marker?.subType === 'result') state = 'completed';
      else if (marker?.subType === 'error') state = 'failed';
      else if (connected && latest?.type === 'tool_call' && latest.toolName === 'AskUserQuestion') state = 'waiting';
      else if (connected && (!latest || latest.subType === 'init')) state = 'idle';
      server.sessions.push({ id: `chat:${session.id}`, sessionId: session.id, serverId: server.id,
        name: session.name, provider: session.provider, cwd: session.workingDir, source: 'chat', state,
        nativeSessionId: session.cliSessionId ?? session.claudeSessionId,
        activity: compact(latest?.type === 'tool_call' ? `Using ${latest.toolName ?? 'tool'}` : latest?.content ??
          (connected ? 'Ready for a message' : 'Open to connect')),
        updatedAt: latest?.timestamp ?? session.lastActiveAt });
    }
  }
  for (const run of snapshot.runs) {
    if (!['implementation', 'retry', 'handoff', 'review', 'terminal'].includes(run.kind)) continue;
    const checkout = checkouts.get(run.checkoutId);
    const server = checkout && byServer.get(checkout.serverId);
    if (!server) continue;
    const execution = run;
    const active = ['queued', 'starting', 'running', 'waiting', 'stopping'].includes(run.state);
    const pending = snapshot.attention.find((item) => item.runId === run.id);
    let state: SessionState = run.state === 'completed' ? 'completed' : run.state === 'failed' ? 'failed'
      : run.state === 'interrupted' ? 'stopped' : run.state === 'lost' ? 'unknown'
      : pending || run.state === 'waiting' ? 'waiting' : 'running';
    const unavailable = active && (execution?.connectionError || !execution?.lastSeenAt || now - execution.lastSeenAt > 30_000);
    if (unavailable) state = 'unknown';
    const event = db.workbench.runActivity(run.id);
    const activity = unavailable ? `Connection unconfirmed${execution?.connectionError ? `: ${execution.connectionError}` : ''}`
      : pending?.title ?? run.error ?? (event?.type === 'message' ? event.text ?? ''
        : event?.type === 'tool' ? 'Using a tool' : run.state === 'completed' ? 'Run finished'
          : run.kind === 'terminal' ? 'Interactive terminal' : run.state);
    server.sessions.push({ id: `run:${run.id}`, runId: run.id, serverId: server.id,
      name: tasks.get(run.taskId)?.title ?? 'Agent session', provider: run.provider, cwd: checkout.path,
      source: 'managed', state, activity: compact(activity), nativeSessionId: run.nativeSessionId,
      updatedAt: run.endedAt ?? event?.time ?? run.startedAt ?? run.createdAt });
  }
  for (const observed of snapshot.observedSessions) {
    const checkout = checkouts.get(observed.checkoutId);
    const server = checkout && byServer.get(checkout.serverId);
    if (!server) continue;
    const known = server.sessions.find((item) => item.nativeSessionId === observed.sessionId && item.provider === observed.provider &&
      item.cwd === observed.cwd);
    if (known) {
      const owned = known.source === 'chat' ? ssh.hasActiveChannel(server.id, known.sessionId!)
        : ['queued', 'starting', 'running', 'waiting', 'stopping', 'lost'].includes(
          snapshot.runs.find((run) => run.id === known.runId)?.state ?? '');
      const released = observed.state === 'ended' || observed.dismissedRevision === observed.revision;
      const confirmedExit = known.source === 'managed' && ['completed', 'failed', 'stopped'].includes(known.state) &&
        observed.lastSeenAt <= known.updatedAt;
      if (owned || released || confirmedExit) continue;
      // A resumed native conversation is not the old Gate process. Opening it must not launch a second writer.
      server.sessions.splice(server.sessions.indexOf(known), 1);
    }
    const ended = observed.state === 'ended' || observed.dismissedRevision === observed.revision;
    const settings = snapshot.hookSettings.find((item) => item.checkoutId === observed.checkoutId);
    const stale = !ended && (now - observed.lastSeenAt > 60_000 || !!settings?.connectionError);
    const state: SessionState = ended ? 'stopped' : stale ? 'unknown' : observed.state === 'busy' ? 'running' : observed.state === 'waiting' ? 'waiting' : 'idle';
    server.sessions.push({ id: `external:${observed.id}`, serverId: server.id,
      name: known?.name ?? tasks.get(observed.taskId ?? '')?.title ?? observed.cwd.split('/').filter(Boolean).at(-1) ?? 'External session',
      provider: observed.provider, cwd: observed.cwd, source: 'external', observation: 'hook', state,
      nativeSessionId: observed.sessionId, updatedAt: observed.lastSeenAt,
      activity: compact(`${stale ? 'No recent update · ' : ''}${hookActivity[observed.event] ?? 'Observed activity'}`) });
  }
  for (const server of servers) {
    const result = discovery.get(server.id);
    if (!result) continue;
    server.discovery = { scanning: result.scanning, checkedAt: result.checkedAt, error: result.error };
    for (const discovered of result.sessions) {
      const known = server.sessions.find((item) => item.provider === discovered.provider &&
        item.nativeSessionId === discovered.nativeSessionId && item.cwd === discovered.cwd);
      if (known) {
        const owned = known.source === 'chat' ? ssh.hasActiveChannel(server.id, known.sessionId!)
          : known.source === 'managed' && ['queued', 'starting', 'running', 'waiting', 'stopping', 'lost'].includes(
            snapshot.runs.find((run) => run.id === known.runId)?.state ?? '');
        if (owned || known.updatedAt >= discovered.updatedAt) continue;
        server.sessions.splice(server.sessions.indexOf(known), 1);
      }
      const stale = !!result.error || !result.checkedAt || now - result.checkedAt > 30_000 ||
        (['running', 'waiting', 'idle'].includes(discovered.state) && now - discovered.updatedAt > 60_000);
      server.sessions.push({ ...discovered, name: known?.name ?? discovered.name,
        state: stale ? 'unknown' : discovered.state,
        activity: stale ? compact(`No recent update · ${discovered.activity}`) : discovered.activity });
    }
  }
  for (const server of servers) server.sessions.sort((a, b) => rank[a.state] - rank[b.state] || b.updatedAt - a.updatedAt);
  return { capturedAt: now, servers };
}
