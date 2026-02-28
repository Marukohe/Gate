# Gate

**Gate** opens a portal to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) on remote servers — code from anywhere, on any device.

Waiting in line, on the couch, on the train — pull out your phone and pick up right where you left off. Gate bridges your browser to Claude Code CLI sessions over SSH + tmux, so your coding environment is always one tap away.

```
Browser (React) ◄──WebSocket──► Node.js Backend ◄──SSH──► Remote Server (tmux + claude)
```

## Example

<table align="center">
  <tr>
    <td align="center"><img src="assets/planning.png" alt="Planning mode" width="240" /><br/><em>Planning mode</em></td>
    <td align="center"><img src="assets/plan_interact.png" alt="Interactive questions" width="240" /><br/><em>Interactive questions</em></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/communication.png" alt="Chat with Claude" width="240" /><br/><em>Chat with Claude</em></td>
    <td align="center"><img src="assets/command_invoke.png" alt="Command execution" width="240" /><br/><em>Command execution</em></td>
  </tr>
</table>

## Key Features

### Access Claude Code from Any Device
Connect to Claude Code CLI running on remote servers via SSH + tmux. Start a coding session on your desktop, then pick it up on your phone while on the go — your sessions persist across devices.

### Bind to Existing Terminal Sessions
Already have Claude Code running in a terminal? Gate can attach to it. When creating a session, Gate lists existing Claude Code JSONL transcripts from the remote server and lets you resume any of them — no need to start from scratch.

### Structured Chat Interface
Raw terminal output is parsed into a clean chat UI: assistant messages with full markdown rendering, collapsible tool call cards, syntax-highlighted code blocks with copy button, and scrollable/wrappable tables.

### Multi-Server, Multi-Session
Manage multiple remote servers, each with multiple Claude sessions. Switch between sessions with tabs or swipe gestures on mobile. Each session tracks its own working directory, git branch, and chat history.

### Plan Tracking Panel
Gate automatically extracts markdown checklists from Claude's output into a dedicated plan panel. View progress at a glance, check off completed steps, or edit plans directly.

### Transcript Sync
Manually sync Claude Code's JSONL transcript to catch up on messages produced outside Gate (e.g., from a direct terminal session). The parser reconstructs the full conversation from the transcript file.

### Mobile-First Responsive Design
Three-column layout on desktop (sidebar + chat + plan panel), drawer-based navigation on tablet, and fullscreen chat with bottom sheets and swipe gestures on mobile. Safe-area support for notched phones.

### Persistent History
All chat messages are stored in SQLite and restored on reconnect. Browse previous conversations even after server restarts.

## Quick Start

### Prerequisites

- Node.js >= 20
- A remote server with SSH access and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- tmux on the remote server
- **Claude Code logged in on the remote server** — SSH into the server and run `claude` once to complete authentication before using Gate

### Install & Run

```bash
git clone https://github.com/Marukohe/Gate.git gate
cd gate
npm install
npm run dev
```

The client runs on `http://localhost:5173` (proxies API/WS to the server on port 3001).

### Add a Server

Open the app → click **Add Server** → fill in your SSH credentials (password or private key). Set a default working directory for new sessions.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server in parallel |
| `npm run dev:client` | Vite dev server only (port 5173) |
| `npm run dev:server` | Express + WS server only (port 3001) |
| `npm run build` | Build both client and server |
| `npm run start` | Start production server |
| `cd server && npx vitest run` | Run server tests |
| `cd server && npx tsc --noEmit` | Type-check server |

## Project Structure

```
gate/
├── client/                      # React frontend
│   └── src/
│       ├── components/
│       │   ├── chat/            # ChatView, MessageBubble, ToolCallCard, ChatInput
│       │   ├── layout/          # AppShell, Sidebar, TopBar
│       │   ├── plan/            # PlanPanel, PlanStepItem
│       │   └── ui/              # shadcn/ui components
│       ├── hooks/               # use-websocket, use-swipe
│       ├── stores/              # Zustand stores (server, session, chat, plan, ui)
│       └── lib/                 # Utilities (plan-parser, server-utils)
├── server/                      # Node.js backend
│   └── src/
│       ├── index.ts             # Express entry point
│       ├── db.ts                # SQLite (servers, sessions, messages)
│       ├── ssh-manager.ts       # SSH connection pool + tmux
│       ├── stream-json-parser.ts# Claude CLI output parser
│       ├── ws-handler.ts        # WebSocket server
│       └── routes/              # REST API
└── docs/                        # Design documents
```

## Tech Stack

**Client:** Vite · React 19 · TypeScript · Tailwind CSS · shadcn/ui · Zustand

**Server:** Express 5 · ws · ssh2 · better-sqlite3 · TypeScript

**Testing:** Vitest

## WebSocket Protocol

Client → Server:
```jsonc
{ "type": "connect" | "input" | "disconnect", "serverId": "...", "sessionId": "...", "text": "..." }
```

Server → Client:
```jsonc
{ "type": "message" | "status" | "history" | "sessions" | "git-info", "serverId": "...", ... }
```

## Responsive Layout

| Breakpoint | Layout |
|------------|--------|
| Desktop (≥1024px) | Sidebar + Chat + Plan panel (3-column) |
| Tablet (768–1023px) | Chat fullwidth, sidebar/plan as drawers |
| Mobile (<768px) | Fullscreen chat, bottom sheet for servers, swipe to switch sessions |

## Why "Gate"?

Named after *Steins;Gate* — the anime where messages travel through time to change the worldline. Here, your messages travel through SSH to reach Claude on a remote server, opening a gate between any device and your coding environment.

## License

MIT
