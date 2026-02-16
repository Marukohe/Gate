# CodingEverywhere - Design Document

## Overview

A responsive web application for "vibe coding" — chat with Claude Code CLI running on remote servers via SSH + tmux, from any device (phone, tablet, desktop).

## Architecture

```
Browser (React) <--WebSocket--> Node.js Backend <--SSH--> Remote Server (tmux + claude)
```

### Tech Stack

- **Frontend**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express + ws (WebSocket) + ssh2 (SSH)
- **Storage**: SQLite (better-sqlite3) — server configs, session history
- **Parser**: Custom terminal output parser for Claude Code CLI

### Deployment

- Internal network only, no authentication required
- Single Node.js process serves both API and static frontend

## Frontend Layout

### Desktop (>=1024px)

Three-column layout:
- **Sidebar (64px)**: Server/project list with icons
- **Chat View (flexible)**: Main conversation area with parsed Claude Code output
- **Plan Panel (320px, collapsible)**: Plan editor and progress tracker

### Tablet (768px - 1023px)

- Sidebar becomes a hamburger-triggered drawer
- Plan Panel becomes a bottom/right floating drawer, hidden by default
- Chat View fills full width

### Mobile (<768px)

- Full-screen Chat View
- Top bar: hamburger (sidebar) + Plan button (plan drawer)
- Sidebar and Plan are full-screen drawer overlays
- Input box fixed at bottom
- Code blocks support horizontal scroll

### Message Types in Chat View

| Type | Rendering |
|------|-----------|
| Claude text reply | Markdown-rendered bubble |
| Code block | Syntax highlighted + copy button |
| Tool call (Edit/Write/Bash etc.) | Collapsible card: tool name + summary, expand for details |
| User input | Right-aligned bubble |
| System message (connection status) | Centered small text |

## Backend

### SSH Manager

```typescript
class SSHManager {
  connections: Map<string, SSHConnection>

  connect(serverConfig): Promise<void>       // Establish SSH connection
  attachTmux(sessionName): Promise<void>     // Attach to existing tmux session
  createTmux(sessionName): Promise<void>     // Create new tmux session, start claude
  sendInput(serverId, text): void            // Write user input to tmux session
  onData(serverId, callback): void           // Listen to tmux output stream
}
```

- `ssh2` library for SSH connections
- Shell channel executes `tmux attach -t <session>` or `tmux new -s <session>`
- Auto-reconnect on disconnect; tmux preserves remote process
- Supports password and private key authentication

### Terminal Output Parser

Parses Claude Code CLI output into structured messages:

1. Strip ANSI escape codes (`strip-ansi`)
2. Split by blocks — Claude Code has distinct patterns: user prompt `>`, Claude reply, tool calls (prefixed with markers like `Edit`, `Bash`, etc.)
3. Classify message type by prefix/format
4. Incremental parsing — streaming data, parser maintains state machine, emits structured messages progressively

```typescript
interface ParsedMessage {
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system'
  content: string
  toolName?: string
  toolDetail?: string
  timestamp: number
}
```

### Data Storage (SQLite)

```sql
-- Server configurations
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  authType TEXT NOT NULL,        -- 'password' or 'privateKey'
  password TEXT,
  privateKeyPath TEXT,
  createdAt INTEGER NOT NULL
);

-- Session records
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  serverId TEXT NOT NULL REFERENCES servers(id),
  tmuxSession TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastActiveAt INTEGER NOT NULL
);

-- Parsed message history (for offline viewing)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  toolName TEXT,
  toolDetail TEXT,
  timestamp INTEGER NOT NULL
);
```

### WebSocket Protocol

```typescript
// Client → Server
{ type: 'connect', serverId: string }
{ type: 'input', serverId: string, text: string }
{ type: 'disconnect', serverId: string }

// Server → Client
{ type: 'message', serverId: string, message: ParsedMessage }
{ type: 'status', serverId: string, status: 'connected' | 'disconnected' | 'error' }
{ type: 'history', serverId: string, messages: ParsedMessage[] }
```

## Plan Management

### Data Model

```typescript
interface Plan {
  id: string
  sessionId: string
  title: string
  content: string          // Raw markdown
  steps: PlanStep[]
  status: 'draft' | 'active' | 'completed'
  createdAt: number
  updatedAt: number
}

interface PlanStep {
  id: string
  text: string
  completed: boolean
  children?: PlanStep[]    // Nested sub-steps
}
```

### Workflow

1. Discuss plan in chat with Claude
2. Claude outputs plan content (markdown with checklist)
3. User clicks "Extract to Plan Panel" button
4. Parse markdown checklist → structured PlanStep[]
5. Plan Panel displays, supports:
   - Check/uncheck steps
   - Edit step text
   - Drag to reorder
   - Add/delete steps
   - Send modified plan back to Claude for execution

### Plan Panel Features

- **View mode**: Checklist display, check to mark progress
- **Edit mode**: Edit markdown source directly, re-parse on save
- **Sync**: Auto-update step status when Claude outputs progress
- **History**: Retain plan modification history

### Mobile

Plan Panel slides in as full-screen drawer from right. Tabs at top switch between "View" and "Edit" modes. Large checkboxes for touch.

## Security

- Internal network deployment only
- No authentication layer
- SSH credentials stored in plaintext in SQLite
- No HTTPS requirement
