# CodingEverywhere

Chat with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI running on remote servers — from any device.

CodingEverywhere bridges your browser to Claude Code sessions over SSH + tmux, giving you a responsive chat interface on phones, tablets, and desktops. Designed for internal network deployment.

```
Browser (React) ◄──WebSocket──► Node.js Backend ◄──SSH──► Remote Server (tmux + claude)
```

## Example

<p align="center">
  <img src="assets/mobile-chat.jpeg" alt="Mobile chat view" width="300" />
</p>

## Features

- **Remote Claude Code access** — connect to any server via SSH, manage multiple tmux sessions
- **Structured chat view** — terminal output is parsed into assistant messages, tool calls (collapsible), and results with syntax-highlighted code blocks
- **Multi-session** — run separate Claude sessions per project/server, switch with tabs or swipe gestures
- **Plan panel** — automatically extracts markdown checklists from Claude's output into an editable sidebar
- **Persistent history** — chat messages are stored in SQLite and restored on reconnect
- **Responsive design** — 3-column desktop layout, bottom-sheet drawers on mobile, safe-area support for notched phones
- **Git integration** — view current branch, switch branches, all from the session bar

## Quick Start

### Prerequisites

- Node.js >= 20
- A remote server with SSH access and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- tmux on the remote server

### Install & Run

```bash
git clone <repo-url> codingeverywhere
cd codingeverywhere
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
codingeverywhere/
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

## License

MIT
