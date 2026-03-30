# Gate Design Document

## 1. Overview

Gate is a responsive web app that bridges a browser-based chat UI to AI coding CLI sessions (Claude Code, OpenAI Codex) running on remote servers via SSH. It lets you "vibe code" from any device — phone, tablet, or desktop.

**Deployment model:** Internal network, no authentication.

## 2. Architecture

```
┌──────────────┐     WebSocket      ┌──────────────┐      SSH        ┌──────────────┐
│              │ ◄────────────────► │              │ ◄─────────────► │Remote Server │
│   Browser    │   messages/status  │  Node.js     │  stdin/stdout   │              │
│   (React)    │   history/git-info │  Backend     │  (ssh2 exec)    │ Claude/Codex │
│              │                    │              │                 │              │
└──────────────┘                    └──────────────┘                 └──────────────┘
       │                                   │
   Zustand stores                   SQLite (better-sqlite3)
   (client state)                   (servers, sessions, messages)
```

### Provider Layer

```
ProviderRegistry
├── ClaudeProvider  (interactive, supportsStdin: true)
└── CodexProvider   (per-message, supportsStdin: false)
```

Each provider implements the `CLIProvider` interface: `buildCommand()`, `formatInput()`, `createParser()`, `extractSessionId()`, `listRemoteSessions()`, `syncTranscript()`.

### Data Flow

1. User types a message in the browser
2. Client sends `{ type: 'input', serverId, sessionId, text }` over WebSocket
3. Server writes text to the SSH channel stdin (interactive providers) or launches a new CLI process (per-message providers)
4. CLI processes and produces NDJSON output on stdout
5. Provider-specific `OutputParser` parses terminal output into typed `ParsedMessage` objects
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
| SSH | ssh2 (connection pool + channel management) |
| Database | better-sqlite3 (WAL mode) |
| CLI Parser | Provider-specific NDJSON parsers |
| Testing | Vitest |

## 4. WebSocket Protocol

### Client to Server

```typescript
interface ClientMessage {
  type:
    | 'connect'              // Attach to a session (loads history + starts CLI)
    | 'input'                // Send user text to CLI
    | 'disconnect'           // Detach from session
    | 'create-session'       // Create a new session
    | 'delete-session'       // Delete a session
    | 'fetch-git-info'       // Get current branch + worktree
    | 'list-branches'        // List local/remote branches
    | 'switch-branch'        // Checkout a different branch
    | 'exec'                 // Run a shell command (! prefix)
    | 'sync-transcript'      // Sync CLI transcript from remote
    | 'list-cli-sessions'    // List remote CLI sessions for a provider
    | 'switch-provider'      // Switch CLI provider (e.g. claude → codex)
    | 'reset-conversation'   // Start a fresh CLI conversation
    | 'resume-cli-session'   // Resume a specific CLI session
    | 'load-more';           // Load older messages
  serverId: string;
  sessionId?: string;
  text?: string;
  branch?: string;
  command?: string;
  claudeSessionId?: string;
  provider?: string;
  workingDir?: string;
  beforeTimestamp?: number;
}
```

### Server to Client

```typescript
interface ServerMessage {
  type:
    | 'message'          // Single parsed message from CLI
    | 'status'           // Connection status change
    | 'history'          // Full message history for a session
    | 'history-prepend'  // Older messages for scroll-back
    | 'sessions'         // Updated session list
    | 'session-created'  // Newly created session
    | 'git-info'         // Branch + worktree info
    | 'branches'         // Branch list response
    | 'sync-result'      // Transcript sync result
    | 'cli-sessions';    // Remote CLI session list
  serverId: string;
  sessionId?: string;
}
```

### Connection Lifecycle

```
Client                          Server
  │                               │
  ├─ connect(serverId, sessionId)─►
  │                               ├─ Load messages from DB (respecting chatStartedAt)
  │                   ◄─ history ─┤
  │                               ├─ Check for active SSH channel
  │                               ├─ If none: SSH connect → start CLI via exec
  │                  ◄─ status ───┤  (status: 'connected')
  │                               │
  ├─ input(text) ────────────────►├─ Write to SSH channel (stdin)
  │                               ├─ Save user message to DB
  │                               │  ... CLI processes ...
  │                  ◄─ message ──┤  (parsed assistant/tool_call/tool_result)
  │                               │
  ├─ disconnect ─────────────────►├─ Close SSH channel
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
  authType TEXT NOT NULL,           -- 'password' | 'privateKey'
  password TEXT,
  privateKeyPath TEXT,
  defaultWorkingDir TEXT,
  createdAt INTEGER NOT NULL
)

sessions (
  id TEXT PRIMARY KEY,
  serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  claudeSessionId TEXT,             -- Legacy, kept for backward compat
  cliSessionId TEXT,                -- Current provider's CLI session ID
  provider TEXT DEFAULT 'claude',   -- Active provider name
  providerSessionMap TEXT,          -- JSON: { [provider]: cliSessionId }
  chatStartedAt INTEGER,            -- Message boundary for current chat
  workingDir TEXT,
  createdAt INTEGER NOT NULL,
  lastActiveAt INTEGER NOT NULL
)

messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                -- assistant | user | tool_call | tool_result | system
  content TEXT NOT NULL,
  toolName TEXT,
  toolDetail TEXT,
  timestamp INTEGER NOT NULL,
  provider TEXT                      -- Which CLI provider produced this message
)
```

### Message Types

| Type | Source | Description |
|------|--------|-------------|
| `user` | WebSocket `input` handler | User's chat text |
| `assistant` | CLI `assistant` event | CLI's text response |
| `tool_call` | CLI `assistant` event | Tool invocation with JSON input |
| `tool_result` | CLI `user` event | Tool execution output |
| `system` | CLI `system`/`result` event | Session init, cost summary, provider switches |

## 6. Client State Management

Six Zustand stores with clear responsibilities:

| Store | Key State | Persisted |
|-------|-----------|-----------|
| `server-store` | Server list, active server ID | `activeServerId` |
| `session-store` | Sessions per server, active session IDs, connection status, git info | `activeSessionId` |
| `chat-store` | Messages keyed by session ID | No (fetched from server) |
| `plan-store` | Extracted plans and checklist state | No |
| `plan-mode-store` | Plan mode phase tracking | No |
| `ui-store` | Sidebar open, plan panel open, sync status | No |

### Persistence Strategy

- `activeServerId` and `activeSessionId` are persisted to localStorage via Zustand's `persist` middleware with `partialize`
- Chat messages are NOT persisted client-side — they are loaded from SQLite on each `connect`
- On page refresh: persisted IDs are validated against the server, then a `connect` message is sent to reload history

## 7. SSH Management

The `SSHManager` class manages a pool of SSH connections and CLI channels:

```
SSHManager
  ├── connections: Map<serverId, { client, channels: Map<sessionId, channel> }>
  │
  ├── connect(config)           → Establish SSH connection
  ├── ensureConnected(serverId) → Ping check + auto-reconnect if stale
  ├── startCLI(serverId, sessionId, command)
  │                             → ssh2 exec to launch CLI process
  ├── sendInput(serverId, sessionId, text)
  │                             → Write to channel stdin
  ├── stopSession(serverId, sessionId)
  │                             → Close the SSH channel
  ├── disconnect(serverId)      → Close all channels + SSH connection
  ├── disconnectAll()           → Disconnect all servers (on shutdown)
  ├── fetchGitInfo(serverId, workingDir)
  │                             → Run git commands, return branch + worktree
  └── runCommand(serverId, workingDir?, command)
                                → Execute arbitrary shell command
```

**CLI invocation examples:**
```bash
# Claude Code (interactive)
$SHELL -lc "cd <workingDir> && claude [--resume <id>] --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions"

# OpenAI Codex (per-message)
$SHELL -lc "cd <workingDir> && codex exec --json [resume '<id>' | '<prompt>']"
```

## 8. Provider Architecture

Each CLI tool is encapsulated as a provider implementing the `CLIProvider` interface:

| Aspect | Claude | Codex |
|--------|--------|-------|
| `supportsStdin` | true | false |
| Launch model | Once, keep running | Per-message |
| Input method | Write JSON to stdin | Pass as CLI argument |
| Resume | `--resume <id>` flag | `codex exec --json resume '<id>'` |
| Parser | Claude-specific NDJSON | Codex-specific JSON |

### Provider Switching

When switching providers (e.g. Claude → Codex):
1. Summarize current conversation context
2. Save current provider's `cliSessionId` to `providerSessionMap`
3. Restore target provider's saved session ID (if any)
4. Launch target CLI with `--resume` (if session exists) and send context summary
5. Display summary in system message

### Chat Management (Switch Chat)

Each Gate session can host multiple CLI conversations:
- **New Chat**: Clears `cliSessionId`, sets `chatStartedAt` boundary, launches CLI fresh
- **Resume**: Sets `cliSessionId` to selected session, auto-syncs transcript, updates `chatStartedAt`
- Messages before `chatStartedAt` are hidden from the current view

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

3. **Parser skips user echoes** — CLI echoes user input as `{type: "user"}` events. The parser skips these to avoid duplicate storage; user messages are saved directly from the WebSocket `input` handler.

4. **Session resumption** — Each session tracks a `cliSessionId` per provider via `providerSessionMap`. On reconnect, the server passes the resume flag to the CLI to continue the conversation.

5. **Per-CLI-session message isolation** — `chatStartedAt` acts as a boundary: switching CLI conversations gives a clean message view without deleting old data.

6. **Provider session preservation** — Switching providers saves the current `cliSessionId` and restores the target's, so switching back resumes instead of creating a new conversation.

7. **Selective state persistence** — Only `activeServerId` and `activeSessionId` are persisted to localStorage. Everything else is ephemeral and fetched from the server on connect.

8. **SSH exec, not tmux** — CLI processes run directly via `ssh2.exec()`, not through tmux. Simpler management, and `--resume` handles continuity. Gate shutdown closes all SSH connections via `disconnectAll()`.

9. **Bottom sheet over sidebar drawer** — On mobile, the server list uses a bottom sheet instead of a left drawer, aligning with modern mobile UX patterns and keeping the trigger button within thumb reach.
