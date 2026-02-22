# CodingEverywhere Design Document

## 1. Overview

CodingEverywhere is a responsive web app that bridges a browser-based chat UI to Claude Code CLI sessions running on remote servers via SSH + tmux. It lets you "vibe code" from any device — phone, tablet, or desktop.

**Deployment model:** Internal network, no authentication.

## 2. Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐      SSH        ┌──────────────┐
│              │ ◄────────────────► │              │ ◄─────────────► │Remote Server │
│   Browser    │   messages/status  │  Node.js     │  stdin/stdout   │              │
│   (React)    │   history/git-info │  Backend     │  (tmux attach)  │  tmux+claude │
│              │                    │              │                 │              │
└──────────────┘                    └──────────────┘                 └──────────────┘
       │                                   │
   Zustand stores                   SQLite (better-sqlite3)
   (client state)                   (servers, sessions, messages)
```

### Data Flow

1. User types a message in the browser
2. Client sends `{ type: 'input', serverId, sessionId, text }` over WebSocket
3. Server writes text to the SSH channel (tmux stdin)
4. Claude CLI processes and produces NDJSON output on stdout
5. `StreamJsonParser` parses terminal output into typed `ParsedMessage` objects
6. Server broadcasts `{ type: 'message', message }` to all connected WebSocket clients
7. Server persists each message to SQLite
8. Client appends the message to the Zustand chat store and renders it

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite + React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand (with selective localStorage persistence) |
| Backend | Express 5 + ws |
| SSH | ssh2 (connection pool + tmux session management) |
| Database | better-sqlite3 (WAL mode) |
| CLI Parser | Custom NDJSON stream parser |
| Testing | Vitest |

## 4. WebSocket Protocol

### Client to Server

```typescript
interface ClientMessage {
  type:
    | 'connect'          // Attach to a session (loads history + starts Claude)
    | 'input'            // Send user text to Claude
    | 'disconnect'       // Detach from session
    | 'create-session'   // Create a new session
    | 'delete-session'   // Delete a session
    | 'fetch-git-info'   // Get current branch + worktree
    | 'list-branches'    // List local/remote branches
    | 'switch-branch'    // Checkout a different branch
    | 'exec';            // Run a shell command (! prefix)
  serverId: string;
  sessionId?: string;
  text?: string;
  branch?: string;
  command?: string;
}
```

### Server to Client

```typescript
interface ServerMessage {
  type:
    | 'message'    // Single parsed message from Claude
    | 'status'     // Connection status change
    | 'history'    // Full message history for a session
    | 'sessions'   // Updated session list
    | 'git-info'   // Branch + worktree info
    | 'branches';  // Branch list response
  serverId: string;
  sessionId?: string;
}
```

### Connection Lifecycle

```
Client                          Server
  │                               │
  ├─ connect(serverId, sessionId)─►
  │                               ├─ Load messages from DB
  │                   ◄─ history ─┤
  │                               ├─ Check for active SSH channel
  │                               ├─ If none: SSH connect → tmux → start Claude
  │                  ◄─ status ───┤  (status: 'connected')
  │                               │
  ├─ input(text) ────────────────►├─ Write to SSH channel
  │                               ├─ Save user message to DB
  │                               │  ... Claude processes ...
  │                  ◄─ message ──┤  (parsed assistant/tool_call/tool_result)
  │                               │
  ├─ disconnect ─────────────────►├─ Stop tmux session
  │                               │
```

## 5. Data Model

### SQLite Schema

```sql
servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  authType TEXT NOT NULL,       -- 'password' | 'privateKey'
  password TEXT,
  privateKeyPath TEXT,
  defaultWorkingDir TEXT,
  createdAt INTEGER NOT NULL
)

sessions (
  id TEXT PRIMARY KEY,
  serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  claudeSessionId TEXT,         -- For --resume on reconnect
  workingDir TEXT,
  createdAt INTEGER NOT NULL,
  lastActiveAt INTEGER NOT NULL
)

messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- assistant | user | tool_call | tool_result | system
  content TEXT NOT NULL,
  toolName TEXT,
  toolDetail TEXT,
  timestamp INTEGER NOT NULL
)
```

### Message Types

| Type | Source | Description |
|------|--------|-------------|
| `user` | WebSocket `input` handler | User's chat text |
| `assistant` | Claude CLI `assistant` event | Claude's text response |
| `tool_call` | Claude CLI `assistant` event | Tool invocation with JSON input |
| `tool_result` | Claude CLI `user` event | Tool execution output |
| `system` | Claude CLI `system`/`result` | Session init, cost summary |

## 6. Client State Management

Four Zustand stores with clear responsibilities:

| Store | Key State | Persisted |
|-------|-----------|-----------|
| `server-store` | Server list, active server ID | `activeServerId` |
| `session-store` | Sessions per server, active session IDs, connection status, git info | `activeSessionId` |
| `chat-store` | Messages keyed by session ID | No (fetched from server) |
| `ui-store` | Sidebar open, plan panel open | No |

### Persistence Strategy

- `activeServerId` and `activeSessionId` are persisted to localStorage via Zustand's `persist` middleware with `partialize`
- Chat messages are NOT persisted client-side — they are loaded from SQLite on each `connect`
- On page refresh: persisted IDs are validated against the server, then a `connect` message is sent to reload history

## 7. SSH & tmux Management

The `SSHManager` class manages a pool of SSH connections and tmux sessions:

```
SSHManager
  ├── connections: Map<serverId, { client, channels: Map<sessionId, channel> }>
  │
  ├── connect(config)          → Establish SSH connection
  ├── startClaude(serverId, sessionId, resumeId?, workingDir?)
  │                            → tmux new-session / send-keys to start Claude CLI
  ├── sendInput(serverId, sessionId, text)
  │                            → Write to tmux stdin
  ├── stopSession(serverId, sessionId)
  │                            → Kill tmux session
  ├── fetchGitInfo(serverId, workingDir)
  │                            → Run git commands, return branch + worktree
  └── runCommand(serverId, workingDir?, command)
                               → Execute arbitrary shell command (! prefix)
```

**Claude CLI invocation:**
```bash
bash -lc "cd <workingDir> && claude -p [--resume <id>] \
  --output-format stream-json --input-format stream-json \
  --verbose --dangerously-skip-permissions"
```

## 8. Terminal Output Parser

`StreamJsonParser` is an EventEmitter-based NDJSON parser that processes Claude CLI's `stream-json` output:

**Input events from Claude CLI:**
- `{type: "system", subtype: "init", session_id}` → system message
- `{type: "assistant", message: {content: [{type: "text"}, {type: "tool_use"}]}}` → assistant text + tool calls
- `{type: "user", message: {content: [{type: "tool_result"}]}}` → tool results
- `{type: "result", duration_ms, num_turns}` → session summary

**Output:** Emits `ParsedMessage` events with normalized type, content, toolName, and toolDetail fields.

## 9. Responsive Layout

```
Desktop (≥1024px)                 Mobile (<768px)
┌────┬──────────┬─────┐           ┌──────────────┐
│    │          │     │           │  Server Name │ TopBar
│ S  │          │  P  │           ├──────────────┤
│ i  │  Chat    │  l  │           │ [sessions]   │ SessionBar
│ d  │  View    │  a  │           ├──────────────┤
│ e  │          │  n  │           │              │
│ b  │          │     │           │  Chat View   │
│ a  │          │  P  │           │              │
│ r  │          │  a  │           │              │
│    │          │  n  │           ├──────────────┤
│    │          │  e  │           │ [av] [input] │ ChatInput
│    │          │  l  │           └──────────────┘
├────┤          ├─────┤               ↑
│+Add│ [input]  │     │          Bottom sheet for
└────┴──────────┴─────┘          server selection
```

| Breakpoint | Layout | Server Selector | Plan Panel |
|------------|--------|----------------|------------|
| Desktop (≥1024px) | 3-column | Left sidebar | Right panel |
| Tablet (768-1023px) | Chat fullwidth | Sheet drawer | Sheet drawer |
| Mobile (<768px) | Fullscreen chat | Bottom sheet (from avatar in input bar) | Right sheet |

### Mobile Interactions

- **Server switching:** Tap the colored avatar circle in the chat input bar → bottom sheet slides up
- **Session switching:** Swipe left/right on the chat area, or tap session tabs
- **Context menus:** Long-press (desktop) or tap the ⋮ button (mobile) on servers and sessions

## 10. Key Design Decisions

1. **WebSocket singleton with queued connect** — A single WS connection is shared across the app. If `connectToSession` is called before the socket is open, the request is queued and flushed on `onopen`. This avoids race conditions on page refresh.

2. **Server-side message persistence** — Messages are stored in SQLite, not client-side localStorage. This keeps the client lightweight and ensures history survives across different devices/browsers.

3. **Parser skips user echoes** — Claude CLI echoes user input as `{type: "user"}` events. The parser skips these to avoid duplicate storage; user messages are saved directly from the WebSocket `input` handler.

4. **Session resumption** — Each session tracks a `claudeSessionId`. On reconnect, the server passes `--resume <id>` to Claude CLI to continue the conversation without re-uploading context.

5. **Selective state persistence** — Only `activeServerId` and `activeSessionId` are persisted to localStorage. Everything else (messages, sessions list, connection status) is ephemeral and fetched from the server on connect.

6. **Bottom sheet over sidebar drawer** — On mobile, the server list uses a bottom sheet instead of a left drawer, aligning with modern mobile UX patterns and keeping the trigger button within thumb reach.
