# Conductor-Inspired P0 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three P0 features inspired by Conductor: (1) Enhanced sidebar with session tree + agent status, (2) Chat/Diff dual tab with GitHub PR integration, (3) Changes panel showing git status with file navigation.

**Architecture:** The sidebar becomes a server→session tree with real-time agent status. The main content area gains a Diff tab alongside Chat. A new right panel shows changed files from `git status`. All git data flows through new WebSocket message types backed by SSH commands on the remote server. Agent status is derived from the existing ParsedMessage stream.

**Tech Stack:** React + Zustand + Tailwind CSS (client), Express + ws + ssh2 (server), existing WebSocket protocol pattern.

---

## File Map

### New Files
- `server/src/git-utils.ts` — Parse `git status --porcelain`, `git diff`, PR info
- `client/src/stores/git-store.ts` — Zustand store for git status, diff, PR data
- `client/src/components/changes/ChangesPanel.tsx` — Right panel: changed files list
- `client/src/components/changes/FileItem.tsx` — Single file row (status badge + name)
- `client/src/components/diff/DiffView.tsx` — Main diff viewer container
- `client/src/components/diff/DiffFile.tsx` — Single file diff with unified/split view
- `client/src/components/diff/diff-parser.ts` — Parse unified diff text into typed hunks

### Modified Files
- `server/src/ssh-manager.ts` — Add `fetchGitStatus()`, `fetchGitDiff()`, `fetchPRInfo()`, `gitCommit()`, `gitCreatePR()`
- `server/src/ws-handler.ts` — Add message handlers: `fetch-git-status`, `fetch-git-diff`, `fetch-pr-info`, `git-commit`, `git-create-pr`
- `client/src/hooks/use-websocket.ts` — Add handlers + send functions for new message types
- `client/src/stores/session-store.ts` — Add `agentStatus` field per session
- `client/src/stores/ui-store.ts` — Add `changesPanelOpen`, `activeTab` ('chat' | 'diff')
- `client/src/components/layout/Sidebar.tsx` — Rewrite: server→session tree with agent status
- `client/src/components/layout/AppShell.tsx` — Add Changes panel column + responsive handling
- `client/src/components/chat/SessionBar.tsx` — Replace session tabs with Chat/Diff tab switcher
- `client/src/components/chat/ChatView.tsx` — Integrate DiffView as sibling to chat content

---

## Task 1: Agent Status Tracking

Derive agent status from the existing message stream and expose it in the session store.

**Files:**
- Modify: `client/src/stores/session-store.ts`
- Modify: `client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Add agentStatus to session store**

In `client/src/stores/session-store.ts`, add the type and state:

```typescript
// After BranchList interface (~line 25)
export type AgentStatus =
  | { state: 'idle' }
  | { state: 'thinking' }
  | { state: 'tool_call'; toolName: string }
  | { state: 'disconnected' }
  | { state: 'connecting' };

// In SessionStore interface, add:
agentStatus: Record<string, AgentStatus>;  // sessionId → status

// Add setter:
setAgentStatus: (sessionId: string, status: AgentStatus) => void;

// In create(), add:
agentStatus: {},
setAgentStatus: (sessionId, status) => set((s) => ({
  agentStatus: { ...s.agentStatus, [sessionId]: status },
})),
```

- [ ] **Step 2: Derive agent status from message events**

In `client/src/hooks/use-websocket.ts`, update the `storeRefs` object to include `setAgentStatus`, and update the `'message'` case:

```typescript
// In storeRefs (~line 34), add:
setAgentStatus: null as null | ReturnType<typeof useSessionStore.getState>['setAgentStatus'],

// In useWebSocket(), add:
const setAgentStatus = useSessionStore((s) => s.setAgentStatus);
// And in the refs update section:
storeRefs.setAgentStatus = setAgentStatus;

// In socket.onmessage, update case 'message' (after addMessage call):
if (data.message.type === 'user') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'thinking' });
} else if (data.message.type === 'tool_call') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'tool_call', toolName: data.message.toolName ?? 'unknown' });
} else if (data.message.type === 'assistant') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'idle' });
} else if (data.message.type === 'system' && data.message.subType === 'result') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'idle' });
}

// In case 'status', derive agent status from connection state:
if (data.status === 'disconnected') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'disconnected' });
} else if (data.status === 'connecting') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'connecting' });
} else if (data.status === 'connected') {
  storeRefs.setAgentStatus?.(data.sessionId, { state: 'idle' });
}
```

- [ ] **Step 3: Also set thinking on input send**

In `use-websocket.ts`, update `sendInput`:

```typescript
const sendInput = useCallback((serverId: string, sessionId: string, text: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', serverId, sessionId, text }));
  storeRefs.setAgentStatus?.(sessionId, { state: 'thinking' });
}, []);
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/session-store.ts client/src/hooks/use-websocket.ts
git commit -m "feat(agent): track agent status from message stream"
```

---

## Task 2: Enhanced Sidebar with Session Tree

Replace the flat server list sidebar with a server→session tree showing agent status, branch, and working directory.

**Files:**
- Modify: `client/src/components/layout/Sidebar.tsx`
- Modify: `client/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Rewrite Sidebar to show session tree**

Replace the server list section in `Sidebar.tsx` (lines 94-160) with a tree that expands each server to show its sessions. The full component is large so here's the key structural change:

```typescript
// After the server button (onClick selects server), add session sub-list:
// For each server, if it's the active server, show its sessions underneath.

// In the server map block, after the server button, add:
{isActive && (
  <div className="ml-4 mt-1 space-y-0.5">
    {(sessionStore.sessions[server.id] ?? []).map((session) => {
      const isActiveSession = activeSessionId === session.id;
      const agent = agentStatus[session.id];
      const git = gitInfo[session.id];
      const dirName = session.workingDir?.split('/').pop() ?? session.name;

      return (
        <button
          key={session.id}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
            isActiveSession
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent/50'
          )}
          onClick={() => { onSelectSession(server.id, session.id); onClose?.(); }}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', agentDot(agent))} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{dirName}</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {git && <span className="truncate">{git.branch}</span>}
              {agent && <span>{agentLabel(agent)}</span>}
            </div>
          </div>
        </button>
      );
    })}
  </div>
)}
```

Helper functions at top of component:

```typescript
function agentDot(status?: AgentStatus): string {
  if (!status || status.state === 'disconnected') return 'bg-muted-foreground/40';
  if (status.state === 'connecting') return 'bg-yellow-500';
  if (status.state === 'thinking') return 'bg-blue-500 animate-pulse';
  if (status.state === 'tool_call') return 'bg-purple-500 animate-pulse';
  return 'bg-green-500'; // idle
}

function agentLabel(status?: AgentStatus): string {
  if (!status || status.state === 'idle') return '';
  if (status.state === 'thinking') return 'thinking...';
  if (status.state === 'tool_call') return status.toolName;
  if (status.state === 'connecting') return 'connecting...';
  return '';
}
```

- [ ] **Step 2: Add onSelectSession prop to Sidebar**

Update `SidebarProps` to add session selection callback:

```typescript
interface SidebarProps {
  onAddServer: () => void;
  onEditServer: (server: ServerType) => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
  onClose?: () => void;
}
```

Thread it from `App.tsx` through `AppShell`:

```typescript
// In App.tsx, add handler:
const handleSelectSession = useCallback((serverId: string, sessionId: string) => {
  setActiveServer(serverId);
  setActiveSession(serverId, sessionId);
  connectToSession(serverId, sessionId);
}, [setActiveServer, setActiveSession, connectToSession]);

// Pass to AppShell, which passes to Sidebar
```

- [ ] **Step 3: Widen sidebar from w-52 to w-64**

In `Sidebar.tsx`, change the container class:

```typescript
// Old:
isMobile ? 'w-full' : 'h-full w-52 border-r'
// New:
isMobile ? 'w-full' : 'h-full w-64 border-r'
```

- [ ] **Step 4: Verify UI renders and types compile**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

Run: `npm run dev:client`
Expected: Sidebar shows session tree under active server

- [ ] **Step 5: Commit**

```bash
git add client/src/components/layout/Sidebar.tsx client/src/components/layout/AppShell.tsx client/src/App.tsx
git commit -m "feat(sidebar): show session tree with agent status and branch"
```

---

## Task 3: Git Status Backend

Add SSH commands and WebSocket handlers for `git status`, `git diff`, and git commit.

**Files:**
- Create: `server/src/git-utils.ts`
- Modify: `server/src/ssh-manager.ts`
- Modify: `server/src/ws-handler.ts`

- [ ] **Step 1: Create git-utils.ts with porcelain parser**

```typescript
// server/src/git-utils.ts

export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitStatusResult {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

const STATUS_MAP: Record<string, GitFileStatus['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  '?': 'untracked',
};

export function parseGitStatusPorcelain(output: string): GitStatusResult {
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];

  for (const line of output.split('\n')) {
    if (!line || line.length < 4) continue;
    const x = line[0]; // index status
    const y = line[1]; // worktree status
    const path = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push({ path, status: 'untracked', staged: false });
      continue;
    }
    if (x !== ' ' && x !== '?') {
      staged.push({ path, status: STATUS_MAP[x] ?? 'modified', staged: true });
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push({ path, status: STATUS_MAP[y] ?? 'modified', staged: false });
    }
  }

  return { staged, unstaged, untracked };
}
```

- [ ] **Step 2: Add git methods to SSHManager**

In `server/src/ssh-manager.ts`, add before `disconnectAll()`:

```typescript
/** Get git status (porcelain format) for a working directory. */
async fetchGitStatus(serverId: string, workingDir: string): Promise<string> {
  const { stdout } = await this.runCommand(serverId, workingDir, 'git status --porcelain');
  return stdout;
}

/** Get git diff for a working directory. diffArgs can be '--staged', a file path, etc. */
async fetchGitDiff(serverId: string, workingDir: string, diffArgs: string = ''): Promise<string> {
  const { stdout } = await this.runCommand(serverId, workingDir, `git diff ${diffArgs}`);
  return stdout;
}

/** Create a git commit. */
async gitCommit(serverId: string, workingDir: string, message: string, files?: string[]): Promise<string> {
  if (files && files.length > 0) {
    const escaped = files.map((f) => `'${f}'`).join(' ');
    await this.runCommand(serverId, workingDir, `git add ${escaped}`);
  }
  const { stdout } = await this.runCommand(serverId, workingDir, `git commit -m '${message.replace(/'/g, "'\\''")}'`);
  return stdout;
}

/** Create a GitHub PR using gh CLI. */
async gitCreatePR(serverId: string, workingDir: string, title: string, body: string): Promise<string> {
  // Push current branch first
  await this.runCommand(serverId, workingDir, 'git push -u origin HEAD');
  const { stdout } = await this.runCommand(serverId, workingDir,
    `gh pr create --title '${title.replace(/'/g, "'\\''")}'` +
    ` --body '${body.replace(/'/g, "'\\''")}'`);
  return stdout.trim();
}

/** Get PR info for current branch. */
async fetchPRInfo(serverId: string, workingDir: string): Promise<string> {
  const { stdout } = await this.runCommand(serverId, workingDir,
    'gh pr view --json number,title,state,url,statusCheckRollup 2>/dev/null || echo ""');
  return stdout.trim();
}
```

- [ ] **Step 3: Add WebSocket handlers**

In `server/src/ws-handler.ts`, add to `ClientMessage` type:

```typescript
type: '...' | 'fetch-git-status' | 'fetch-git-diff' | 'fetch-pr-info' | 'git-commit' | 'git-create-pr';
```

Add `message` and `files` fields to ClientMessage:

```typescript
message?: string;  // for git-commit
files?: string[];  // for git-commit
title?: string;    // for git-create-pr
body?: string;     // for git-create-pr
diffArgs?: string; // for fetch-git-diff
```

Add to `ServerMessage` type:

```typescript
type: '...' | 'git-status' | 'git-diff' | 'pr-info' | 'git-commit-result' | 'git-create-pr-result';
```

Add case handlers before the closing `}` of the switch:

```typescript
case 'fetch-git-status': {
  if (!msg.sessionId) return;
  const gsSession = db.getSession(msg.sessionId);
  if (!gsSession?.workingDir) return;
  if (!sshManager.isConnected(msg.serverId)) return;
  const raw = await sshManager.fetchGitStatus(msg.serverId, gsSession.workingDir);
  ws.send(JSON.stringify({ type: 'git-status', serverId: msg.serverId, sessionId: msg.sessionId, raw }));
  break;
}

case 'fetch-git-diff': {
  if (!msg.sessionId) return;
  const gdSession = db.getSession(msg.sessionId);
  if (!gdSession?.workingDir) return;
  if (!sshManager.isConnected(msg.serverId)) return;
  const diff = await sshManager.fetchGitDiff(msg.serverId, gdSession.workingDir, msg.diffArgs ?? '');
  ws.send(JSON.stringify({ type: 'git-diff', serverId: msg.serverId, sessionId: msg.sessionId, diff }));
  break;
}

case 'fetch-pr-info': {
  if (!msg.sessionId) return;
  const prSession = db.getSession(msg.sessionId);
  if (!prSession?.workingDir) return;
  if (!sshManager.isConnected(msg.serverId)) return;
  const prJson = await sshManager.fetchPRInfo(msg.serverId, prSession.workingDir);
  ws.send(JSON.stringify({ type: 'pr-info', serverId: msg.serverId, sessionId: msg.sessionId, data: prJson }));
  break;
}

case 'git-commit': {
  if (!msg.sessionId || !msg.message) return;
  const gcSession = db.getSession(msg.sessionId);
  if (!gcSession?.workingDir) return;
  if (!sshManager.isConnected(msg.serverId)) return;
  try {
    const result = await sshManager.gitCommit(msg.serverId, gcSession.workingDir, msg.message, msg.files);
    ws.send(JSON.stringify({ type: 'git-commit-result', serverId: msg.serverId, sessionId: msg.sessionId, success: true, output: result }));
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'git-commit-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: err.message }));
  }
  break;
}

case 'git-create-pr': {
  if (!msg.sessionId || !msg.title) return;
  const cpSession = db.getSession(msg.sessionId);
  if (!cpSession?.workingDir) return;
  if (!sshManager.isConnected(msg.serverId)) return;
  try {
    const url = await sshManager.gitCreatePR(msg.serverId, cpSession.workingDir, msg.title, msg.body ?? '');
    ws.send(JSON.stringify({ type: 'git-create-pr-result', serverId: msg.serverId, sessionId: msg.sessionId, success: true, url }));
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'git-create-pr-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: err.message }));
  }
  break;
}
```

- [ ] **Step 4: Run server type check and tests**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

Run: `cd server && npx vitest run`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add server/src/git-utils.ts server/src/ssh-manager.ts server/src/ws-handler.ts
git commit -m "feat(git): add git status, diff, commit, and PR WebSocket handlers"
```

---

## Task 4: Git Store + WebSocket Client Handlers

Create a Zustand store for git data and wire up the WebSocket client.

**Files:**
- Create: `client/src/stores/git-store.ts`
- Modify: `client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Create git-store.ts**

```typescript
// client/src/stores/git-store.ts
import { create } from 'zustand';

export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitStatusResult {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export interface PRInfo {
  number: number;
  title: string;
  state: string;
  url: string;
}

interface GitStore {
  status: Record<string, GitStatusResult>;   // sessionId → git status
  diff: Record<string, string>;              // sessionId → raw diff text
  prInfo: Record<string, PRInfo | null>;     // sessionId → PR info
  selectedFile: Record<string, string | null>; // sessionId → selected file path in changes panel

  setStatus: (sessionId: string, result: GitStatusResult) => void;
  setDiff: (sessionId: string, diff: string) => void;
  setPRInfo: (sessionId: string, info: PRInfo | null) => void;
  setSelectedFile: (sessionId: string, file: string | null) => void;
}

export const useGitStore = create<GitStore>((set) => ({
  status: {},
  diff: {},
  prInfo: {},
  selectedFile: {},

  setStatus: (sessionId, result) => set((s) => ({
    status: { ...s.status, [sessionId]: result },
  })),
  setDiff: (sessionId, diff) => set((s) => ({
    diff: { ...s.diff, [sessionId]: diff },
  })),
  setPRInfo: (sessionId, info) => set((s) => ({
    prInfo: { ...s.prInfo, [sessionId]: info },
  })),
  setSelectedFile: (sessionId, file) => set((s) => ({
    selectedFile: { ...s.selectedFile, [sessionId]: file },
  })),
}));
```

- [ ] **Step 2: Parse git status porcelain on client**

Add parser function at the bottom of `git-store.ts`:

```typescript
export function parseGitStatusPorcelain(output: string): GitStatusResult {
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];

  const STATUS_MAP: Record<string, GitFileStatus['status']> = {
    A: 'added', M: 'modified', D: 'deleted', R: 'renamed', '?': 'untracked',
  };

  for (const line of output.split('\n')) {
    if (!line || line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const path = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push({ path, status: 'untracked', staged: false });
      continue;
    }
    if (x !== ' ' && x !== '?') {
      staged.push({ path, status: STATUS_MAP[x] ?? 'modified', staged: true });
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push({ path, status: STATUS_MAP[y] ?? 'modified', staged: false });
    }
  }

  return { staged, unstaged, untracked };
}
```

- [ ] **Step 3: Wire up WebSocket handlers**

In `client/src/hooks/use-websocket.ts`:

Add imports:
```typescript
import { useGitStore, parseGitStatusPorcelain } from '../stores/git-store';
```

Add to `storeRefs`:
```typescript
setGitStatus: null as null | ReturnType<typeof useGitStore.getState>['setStatus'],
setGitDiff: null as null | ReturnType<typeof useGitStore.getState>['setDiff'],
setPRInfo: null as null | ReturnType<typeof useGitStore.getState>['setPRInfo'],
```

In `useWebSocket()`, add:
```typescript
const setGitStatus = useGitStore((s) => s.setStatus);
const setGitDiff = useGitStore((s) => s.setDiff);
const setPRInfo = useGitStore((s) => s.setPRInfo);
storeRefs.setGitStatus = setGitStatus;
storeRefs.setGitDiff = setGitDiff;
storeRefs.setPRInfo = setPRInfo;
```

Add message handlers in `socket.onmessage`:
```typescript
case 'git-status':
  if (data.sessionId) {
    storeRefs.setGitStatus?.(data.sessionId, parseGitStatusPorcelain(data.raw));
  }
  break;
case 'git-diff':
  if (data.sessionId) {
    storeRefs.setGitDiff?.(data.sessionId, data.diff);
  }
  break;
case 'pr-info':
  if (data.sessionId && data.data) {
    try {
      const info = JSON.parse(data.data);
      storeRefs.setPRInfo?.(data.sessionId, info.number ? info : null);
    } catch { storeRefs.setPRInfo?.(data.sessionId, null); }
  }
  break;
```

Add send functions:
```typescript
const fetchGitStatus = useCallback((serverId: string, sessionId: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'fetch-git-status', serverId, sessionId }));
}, []);

const fetchGitDiff = useCallback((serverId: string, sessionId: string, diffArgs?: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'fetch-git-diff', serverId, sessionId, diffArgs }));
}, []);

const fetchPRInfo = useCallback((serverId: string, sessionId: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'fetch-pr-info', serverId, sessionId }));
}, []);

const gitCommit = useCallback((serverId: string, sessionId: string, message: string, files?: string[]) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'git-commit', serverId, sessionId, message, files }));
}, []);

const gitCreatePR = useCallback((serverId: string, sessionId: string, title: string, body?: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'git-create-pr', serverId, sessionId, title, body }));
}, []);
```

Add to return object:
```typescript
return { ..., fetchGitStatus, fetchGitDiff, fetchPRInfo, gitCommit, gitCreatePR };
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/git-store.ts client/src/hooks/use-websocket.ts
git commit -m "feat(git): add git store and WebSocket client handlers"
```

---

## Task 5: Diff Parser + DiffView Components

Build the diff viewer that renders unified diff output.

**Files:**
- Create: `client/src/components/diff/diff-parser.ts`
- Create: `client/src/components/diff/DiffFile.tsx`
- Create: `client/src/components/diff/DiffView.tsx`

- [ ] **Step 1: Create diff-parser.ts**

```typescript
// client/src/components/diff/diff-parser.ts

export interface DiffHunkLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface DiffFileEntry {
  path: string;
  hunks: DiffHunk[];
}

export function parseDiff(raw: string): DiffFileEntry[] {
  const files: DiffFileEntry[] = [];
  const fileChunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of fileChunks) {
    const lines = chunk.split('\n');
    // Extract file path from "a/path b/path"
    const header = lines[0] ?? '';
    const match = header.match(/b\/(.+)$/);
    const path = match?.[1] ?? header;

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines.slice(1)) {
      if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        oldLine = m ? parseInt(m[1], 10) : 0;
        newLine = m ? parseInt(m[2], 10) : 0;
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
      } else if (currentHunk) {
        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ });
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++ });
        } else if (line.startsWith(' ') || line === '') {
          currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
        }
      }
    }

    if (hunks.length > 0) {
      files.push({ path, hunks });
    }
  }

  return files;
}
```

- [ ] **Step 2: Create DiffFile.tsx**

```typescript
// client/src/components/diff/DiffFile.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DiffFileEntry } from './diff-parser';
import { cn } from '@/lib/utils';

interface DiffFileProps {
  file: DiffFileEntry;
  defaultOpen?: boolean;
}

export function DiffFile({ file, defaultOpen = true }: DiffFileProps) {
  const [open, setOpen] = useState(defaultOpen);
  const adds = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0);
  const removes = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'remove').length, 0);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-mono hover:bg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="truncate flex-1 text-left">{file.path}</span>
        <span className="text-green-600 dark:text-green-400">+{adds}</span>
        <span className="text-red-600 dark:text-red-400">-{removes}</span>
      </button>
      {open && (
        <div className="overflow-x-auto text-xs font-mono">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="bg-blue-500/10 px-3 py-0.5 text-blue-600 dark:text-blue-400">{hunk.header}</div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={cn(
                    'px-3 whitespace-pre',
                    line.type === 'add' && 'bg-green-500/10 text-green-700 dark:text-green-300',
                    line.type === 'remove' && 'bg-red-500/10 text-red-700 dark:text-red-300',
                  )}
                >
                  <span className="inline-block w-4 select-none text-muted-foreground">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  {line.content}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create DiffView.tsx**

```typescript
// client/src/components/diff/DiffView.tsx
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useGitStore } from '@/stores/git-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { parseDiff } from './diff-parser';
import { DiffFile } from './DiffFile';

export function DiffView() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const rawDiff = useGitStore((s) => activeSessionId ? s.diff[activeSessionId] : undefined);
  const { fetchGitDiff } = useWebSocket();

  useEffect(() => {
    if (activeServerId && activeSessionId) {
      fetchGitDiff(activeServerId, activeSessionId);
    }
  }, [activeServerId, activeSessionId, fetchGitDiff]);

  if (rawDiff === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const files = parseDiff(rawDiff);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="mx-auto max-w-4xl space-y-3 py-4">
        {files.map((file) => (
          <DiffFile key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/components/diff/
git commit -m "feat(diff): add diff parser and viewer components"
```

---

## Task 6: Chat/Diff Tab Switcher + PR Button

Replace the session tab bar with a Chat/Diff switcher and add PR controls.

**Files:**
- Modify: `client/src/stores/ui-store.ts`
- Modify: `client/src/components/chat/SessionBar.tsx`
- Modify: `client/src/components/chat/ChatView.tsx`

- [ ] **Step 1: Add activeTab to ui-store**

In `client/src/stores/ui-store.ts`:

```typescript
// Add to UIStore interface:
activeTab: 'chat' | 'diff';
setActiveTab: (tab: 'chat' | 'diff') => void;

// Add to create():
activeTab: 'chat',
setActiveTab: (tab) => set({ activeTab: tab }),
```

- [ ] **Step 2: Update SessionBar with Chat/Diff tabs**

In `SessionBar.tsx`, add a tab group at the start of the bar. Keep existing session pills but move them into a secondary row or dropdown.

Add before the session pills in the `flex items-center gap-1` container:

```typescript
// Import useUIStore
const activeTab = useUIStore((s) => s.activeTab);
const setActiveTab = useUIStore((s) => s.setActiveTab);
const prInfo = useGitStore((s) => activeSessionId ? s.prInfo[activeSessionId] : null);

// Tab buttons at the start of the bar:
<div className="flex items-center gap-0.5 mr-2">
  <button
    className={cn(
      'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
      activeTab === 'chat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
    )}
    onClick={() => setActiveTab('chat')}
  >
    Chat
  </button>
  <button
    className={cn(
      'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
      activeTab === 'diff' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
    )}
    onClick={() => setActiveTab('diff')}
  >
    Diff
  </button>
</div>

// After ProviderSwitcher, add PR button:
{prInfo && (
  <a
    href={prInfo.url}
    target="_blank"
    rel="noopener noreferrer"
    className="ml-1 inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400 hover:bg-green-500/20"
  >
    PR #{prInfo.number}
  </a>
)}
```

- [ ] **Step 3: Integrate DiffView into ChatView**

In `ChatView.tsx`, conditionally render DiffView or Chat content based on `activeTab`:

```typescript
import { DiffView } from '../diff/DiffView';
import { useUIStore } from '@/stores/ui-store';

// Inside ChatView, after SessionBar and status bars:
const activeTab = useUIStore((s) => s.activeTab);

// Replace the relative flex-1 div with:
{activeTab === 'chat' ? (
  <div className="relative flex-1 flex flex-col overflow-hidden">
    <PlanModeOverlay />
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4" {...swipe}>
      {/* existing message rendering */}
    </div>
    <ChatInput onSend={onSend} disabled={!isConnected} />
  </div>
) : (
  <DiffView />
)}
```

- [ ] **Step 4: Verify types compile and UI works**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/stores/ui-store.ts client/src/components/chat/SessionBar.tsx client/src/components/chat/ChatView.tsx
git commit -m "feat(ui): add Chat/Diff tab switcher with PR badge"
```

---

## Task 7: Changes Panel

Build the right-side changes panel showing git status.

**Files:**
- Create: `client/src/components/changes/FileItem.tsx`
- Create: `client/src/components/changes/ChangesPanel.tsx`
- Modify: `client/src/stores/ui-store.ts`
- Modify: `client/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Add changesPanelOpen to ui-store**

In `client/src/stores/ui-store.ts`:

```typescript
// Add to UIStore interface:
changesPanelOpen: boolean;
setChangesPanelOpen: (open: boolean) => void;
toggleChangesPanel: () => void;

// Add to create():
changesPanelOpen: true,
setChangesPanelOpen: (open) => set({ changesPanelOpen: open }),
toggleChangesPanel: () => set((s) => ({ changesPanelOpen: !s.changesPanelOpen })),
```

- [ ] **Step 2: Create FileItem.tsx**

```typescript
// client/src/components/changes/FileItem.tsx
import { cn } from '@/lib/utils';
import type { GitFileStatus } from '@/stores/git-store';

const STATUS_COLORS: Record<string, string> = {
  added: 'text-green-600 dark:text-green-400',
  modified: 'text-yellow-600 dark:text-yellow-400',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-blue-600 dark:text-blue-400',
  untracked: 'text-muted-foreground',
};

const STATUS_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?',
};

interface FileItemProps {
  file: GitFileStatus;
  selected?: boolean;
  onClick?: () => void;
}

export function FileItem({ file, selected, onClick }: FileItemProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
        selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      )}
      onClick={onClick}
      title={file.path}
    >
      <span className={cn('shrink-0 font-mono font-bold', STATUS_COLORS[file.status])}>
        {STATUS_LETTERS[file.status]}
      </span>
      <span className="truncate">
        <span className="font-medium">{fileName}</span>
        {dirPath && <span className="text-muted-foreground ml-1">{dirPath}</span>}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Create ChangesPanel.tsx**

```typescript
// client/src/components/changes/ChangesPanel.tsx
import { useEffect } from 'react';
import { GitCommitHorizontal, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGitStore } from '@/stores/git-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { FileItem } from './FileItem';

export function ChangesPanel() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const gitStatus = useGitStore((s) => activeSessionId ? s.status[activeSessionId] : undefined);
  const selectedFile = useGitStore((s) => activeSessionId ? s.selectedFile[activeSessionId] : null);
  const setSelectedFile = useGitStore((s) => s.setSelectedFile);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const { fetchGitStatus, fetchGitDiff } = useWebSocket();

  // Fetch git status on mount and periodically
  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    fetchGitStatus(activeServerId, activeSessionId);
    const interval = setInterval(() => fetchGitStatus(activeServerId, activeSessionId), 15_000);
    return () => clearInterval(interval);
  }, [activeServerId, activeSessionId, fetchGitStatus]);

  const handleFileClick = (path: string) => {
    if (!activeSessionId || !activeServerId) return;
    setSelectedFile(activeSessionId, path);
    // Switch to diff tab and fetch diff for this file
    setActiveTab('diff');
    fetchGitDiff(activeServerId, activeSessionId, `-- '${path}'`);
  };

  const totalChanges = (gitStatus?.staged.length ?? 0) + (gitStatus?.unstaged.length ?? 0) + (gitStatus?.untracked.length ?? 0);

  return (
    <div className="flex h-full flex-col bg-muted/20">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium">Changes</span>
        {totalChanges > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {totalChanges}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1">
        {!gitStatus && (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
        )}

        {gitStatus?.staged.length ? (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
              Staged ({gitStatus.staged.length})
            </div>
            {gitStatus.staged.map((f) => (
              <FileItem key={'s-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path)} />
            ))}
          </div>
        ) : null}

        {gitStatus?.unstaged.length ? (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
              Modified ({gitStatus.unstaged.length})
            </div>
            {gitStatus.unstaged.map((f) => (
              <FileItem key={'u-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path)} />
            ))}
          </div>
        ) : null}

        {gitStatus?.untracked.length ? (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Untracked ({gitStatus.untracked.length})
            </div>
            {gitStatus.untracked.map((f) => (
              <FileItem key={'t-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path)} />
            ))}
          </div>
        ) : null}

        {gitStatus && totalChanges === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">Working tree clean</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrate ChangesPanel into AppShell**

In `AppShell.tsx`, add the Changes panel as a fourth column after the plan panel block:

```typescript
import { ChangesPanel } from '@/components/changes/ChangesPanel';

// In the flex-1 overflow-hidden div (line 63), after the plan panel block:
{changesPanelOpen && (
  <div className="hidden w-64 shrink-0 overflow-hidden border-l lg:block">
    <ChangesPanel />
  </div>
)}

// Mobile: add Sheet for changes panel (same pattern as plan panel)
```

Add a toggle button in `SessionBar.tsx` for the changes panel:

```typescript
import { FolderGit2 } from 'lucide-react';
const changesPanelOpen = useUIStore((s) => s.changesPanelOpen);
const toggleChangesPanel = useUIStore((s) => s.toggleChangesPanel);

// After the plan toggle button:
<Button
  variant="ghost"
  size="icon"
  className={cn('h-6 w-6 shrink-0', changesPanelOpen && 'bg-accent')}
  onClick={toggleChangesPanel}
  title="Toggle changes panel"
>
  <FolderGit2 className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 5: Verify types compile and UI renders**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add client/src/components/changes/ client/src/stores/ui-store.ts client/src/components/layout/AppShell.tsx client/src/components/chat/SessionBar.tsx
git commit -m "feat(changes): add Changes panel with git status file tree"
```

---

## Task 8: Auto-Refresh Git Status After Agent Turns

Automatically refresh git status and diff after Claude completes a turn.

**Files:**
- Modify: `server/src/ws-handler.ts`

- [ ] **Step 1: Broadcast git status after result messages**

In `ws-handler.ts`, find the existing git-info auto-refresh block (after `message.type === 'system' && message.subType === 'result'`, around line 98). Add git status fetch alongside it:

```typescript
// After the existing git-info refresh block:
if (message.type === 'system' && message.subType === 'result') {
  const s = db.getSession(sessionId);
  if (s?.workingDir && sshManager.isConnected(serverId)) {
    // Existing git-info refresh
    sshManager.fetchGitInfo(serverId, s.workingDir).then((info) => {
      if (info) broadcast(wss, { type: 'git-info', serverId, sessionId, ...info });
    }).catch(() => {});

    // Also refresh git status for the changes panel
    sshManager.fetchGitStatus(serverId, s.workingDir).then((raw) => {
      broadcast(wss, { type: 'git-status', serverId, sessionId, raw });
    }).catch(() => {});
  }
}
```

- [ ] **Step 2: Verify server compiles and tests pass**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass

- [ ] **Step 3: Commit**

```bash
git add server/src/ws-handler.ts
git commit -m "feat(git): auto-refresh git status after agent completes a turn"
```

---

## Task 9: PR Integration (Create PR Dialog)

Add ability to create GitHub PRs from within Gate.

**Files:**
- Create: `client/src/components/changes/CreatePRDialog.tsx`
- Modify: `client/src/components/changes/ChangesPanel.tsx`

- [ ] **Step 1: Create CreatePRDialog.tsx**

```typescript
// client/src/components/changes/CreatePRDialog.tsx
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface CreatePRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string, body: string) => void;
  defaultBranch?: string;
}

export function CreatePRDialog({ open, onOpenChange, onSubmit, defaultBranch }: CreatePRDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), body.trim());
    setTitle('');
    setBody('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>Push current branch and open a PR on GitHub.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {defaultBranch && (
            <div className="text-xs text-muted-foreground">
              Branch: <span className="font-mono">{defaultBranch}</span>
            </div>
          )}
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR title"
            autoFocus
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Description (optional)"
            rows={4}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!title.trim()}>Create PR</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add PR button to ChangesPanel**

In `ChangesPanel.tsx`, add at the bottom of the panel (before the closing `</div>`):

```typescript
import { CreatePRDialog } from './CreatePRDialog';

// State:
const [prDialogOpen, setPRDialogOpen] = useState(false);
const prInfo = useGitStore((s) => activeSessionId ? s.prInfo[activeSessionId] : null);
const gitBranch = useSessionStore((s) => activeSessionId ? s.gitInfo[activeSessionId]?.branch : undefined);
const { gitCreatePR, fetchPRInfo } = useWebSocket();

// Fetch PR info on mount
useEffect(() => {
  if (activeServerId && activeSessionId) {
    fetchPRInfo(activeServerId, activeSessionId);
  }
}, [activeServerId, activeSessionId, fetchPRInfo]);

// Bottom actions bar:
<div className="border-t px-2 py-2 space-y-1.5">
  {prInfo ? (
    <a
      href={prInfo.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/20"
    >
      <ExternalLink className="h-3 w-3" />
      PR #{prInfo.number} ({prInfo.state})
    </a>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="w-full text-xs"
      onClick={() => setPRDialogOpen(true)}
      disabled={totalChanges === 0}
    >
      <GitCommitHorizontal className="mr-1.5 h-3 w-3" />
      Create PR
    </Button>
  )}
</div>

<CreatePRDialog
  open={prDialogOpen}
  onOpenChange={setPRDialogOpen}
  onSubmit={(title, body) => {
    if (activeServerId && activeSessionId) {
      gitCreatePR(activeServerId, activeSessionId, title, body);
    }
  }}
  defaultBranch={gitBranch}
/>
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit -p client/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/changes/CreatePRDialog.tsx client/src/components/changes/ChangesPanel.tsx
git commit -m "feat(pr): add Create PR dialog with GitHub integration"
```

---

## Task 10: End-to-End Testing & Polish

Wire everything together and verify the full flow works.

**Files:**
- Modify: `client/src/App.tsx` (pass new props)
- Modify: various files for polish

- [ ] **Step 1: Wire session selection from sidebar to App**

In `App.tsx`, ensure `handleSelectSession` is passed through `AppShell` to `Sidebar`:

```typescript
const handleSelectSession = useCallback((serverId: string, sessionId: string) => {
  setActiveServer(serverId);
  setActiveSession(serverId, sessionId);
  connectToSession(serverId, sessionId);
}, [setActiveServer, setActiveSession, connectToSession]);
```

Pass through `AppShell` as prop, then to `Sidebar`.

- [ ] **Step 2: Auto-fetch PR info after git-info updates**

In `App.tsx`, alongside the existing `fetchGitInfo` interval, also fetch PR info:

```typescript
// After the existing git-info poll:
fetchPRInfo(activeServerId, activeSessionId);
```

- [ ] **Step 3: Type check both client and server**

Run: `npx tsc --noEmit -p client/tsconfig.json && cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run server tests**

Run: `cd server && npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Test full flow manually**

Start dev server: `npm run dev`

Verify:
1. Sidebar shows session tree under active server with agent status
2. Agent status updates live (idle → thinking → tool_call → idle)
3. Chat/Diff tabs switch correctly
4. Diff tab shows file changes with syntax coloring
5. Changes panel on the right shows staged/unstaged/untracked files
6. Clicking a file in Changes panel opens its diff
7. Changes auto-refresh after Claude completes a turn
8. Create PR button works (if `gh` CLI is installed on remote)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(conductor): wire up P0 features end-to-end"
```

---
