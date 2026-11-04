# Gate

[English](README.md) | [中文](README_CN.md)

**Gate** is a panel for monitoring AI coding sessions across your servers.
See what is running, what needs you, and what finished. Open a session when you want to act.

```
Browser (React) <--HTTP/WebSocket--> Node.js Backend <--SSH--> Remote Server
                                     |
                              Provider Layer
                              Claude / Codex / ...
```

## Session panel

![Session monitoring panel](assets/session-monitor.png)

- **Servers and sessions** — One page, grouped by server, with search. No project or task setup is required.
- **Progress at a glance** — Each session shows its state, latest activity, and update time. Decisions and failures
  appear first within each server. Unknown or stale activity is clearly distinguished from a running process.
- **Direct actions** — Add a server, create a Codex/Claude session, edit SSH settings, or open a conversation directly.
  Managed sessions open their logs, pending decisions, stop controls, or terminal attachment in a focused dialog.
- **Native activity** — Codex sessions started in a terminal appear automatically through SSH/SFTP discovery.
  Existing checkout hooks also report external activity. These sessions remain controlled in their original terminals.
- **Responsive and persistent** — The same panel works on desktop and phone, with light/dark themes and saved history.
  Old managed task/workspace data and deep links remain available for compatibility.

## Quick Start

### Prerequisites

- Node.js >= 20
- A remote server with SSH access and at least one of:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — run `claude` once on the server to complete authentication
  - [OpenAI Codex CLI](https://github.com/openai/codex) — run `codex` once on the server to complete authentication

### Install via npm (recommended)

```bash
npm i -g @marukohe/gate
gate
```

Open `http://localhost:3030` in your browser. Data is stored in `~/.gate/`.

CLI options:

```bash
gate --port 8080          # custom port (default: 3030)
gate --host 127.0.0.1     # bind address (default: 0.0.0.0)
gate --data-dir /my/data  # custom data directory (default: ~/.gate)
```

### Add a Server

Click **Add server** → fill in your SSH credentials (password or private key). Existing Codex sessions under that
SSH user's `~/.codex` appear automatically. Use **+ Session** to create a conversation from Gate.

## Development

The default view is the [session monitor](docs/session-monitor.md). Its read-only API polls saved messages,
managed runtime state, hook observations, and cached Codex activity. Background SSH/SFTP discovery reads session
files without launching or resuming coding agents.
Contributors should read [LESSONS.md](LESSONS.md) and record verified problems there.
Keep documentation focused on current usage and architecture; do not commit implementation journals or acceptance reports.
See [managed execution](docs/managed-execution.md) for runtime setup and guarantees.

### Setup

```bash
git clone https://github.com/Marukohe/Gate.git gate
cd gate
npm install
npm run dev
```

The client runs on `http://localhost:5173` (proxies API/WS to the server on port 3030).

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start client + server in parallel |
| `npm run dev:client` | Vite dev server only (port 5173) |
| `npm run dev:server` | Express + WS server only (port 3030) |
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
│       │   ├── chat/            # ChatView, SessionBar, MessageBubble, ToolActivityBlock,
│       │   │                    # ChatInput, ProviderSwitcher, ResumeChatDialog, BranchSwitcher
│       │   ├── layout/          # AppHeader, AppShell
│       │   ├── plan/            # PlanPanel, PlanStepItem
│       │   ├── plan-mode/       # PlanModeOverlay, PlanModeQuestion, PlanModeThinking
│       │   ├── server/          # ServerDialog
│       │   ├── workspace/       # WorkspaceHome, WorkspaceStart, WorkspaceInspector, WorkspaceActionBar
│       │   └── ui/              # shadcn/ui components
│       ├── hooks/               # use-websocket, use-swipe
│       ├── stores/              # Zustand stores (server, session, chat, git, plan, workspace, ui)
│       └── lib/                 # Utilities (plan-parser, provider-colors, server-utils, notification)
├── server/                      # Node.js backend
│   └── src/
│       ├── index.ts             # Express entry point
│       ├── db.ts                # SQLite (servers, sessions, messages)
│       ├── ssh-manager.ts       # SSH connection pool + CLI channel management
│       ├── ssh-browse.ts        # Remote directory browsing
│       ├── repo-scripts.ts      # Optional gate.json script parsing
│       ├── git-utils.ts         # Git command helpers
│       ├── workspace-actions.ts # Workspace delivery action state
│       ├── workspace-inspector.ts # Workspace inspector snapshots
│       ├── ws-handler.ts        # WebSocket server
│       ├── routes/              # REST API
│       ├── providers/
│       │   ├── types.ts         # CLIProvider interface, OutputParser, ParsedMessage
│       │   ├── registry.ts      # Provider registration and lookup
│       │   ├── claude/          # Claude Code CLI provider
│       │   └── codex/           # OpenAI Codex CLI provider
│       └── __tests__/           # Vitest test suites
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
{ "type": "switch-provider", "serverId": "...", "sessionId": "...", "provider": "codex" }
{ "type": "reset-conversation" | "resume-cli-session", "serverId": "...", "sessionId": "...", "claudeSessionId": "..." }
{ "type": "list-cli-sessions", "serverId": "...", "workingDir": "...", "provider": "claude" }
{ "type": "exec", "serverId": "...", "sessionId": "...", "workspaceId": "...", "command": "git status", "terminal": true, "requestId": "..." }
{ "type": "list-workspaces" | "create-workspace" | "update-workspace" | "delete-workspace", "workspaceId": "...", ... }
{ "type": "start-workspace-task", "workspaceId": "...", "goal": "...", "provider": "claude", "branchMode": "create", "worktreeMode": "isolated" }
{ "type": "fetch-workspace-inspector" | "run-workspace-script" | "run-workspace-action", "workspaceId": "...", ... }
```

Server → Client:
```jsonc
{ "type": "message" | "status" | "history" | "sessions" | "git-info", "serverId": "...", ... }
{ "type": "cli-sessions", "serverId": "...", "sessions": ["..."] }
{ "type": "exec-result", "workspaceId": "...", "requestId": "...", "stdout": "...", "stderr": "...", "exitCode": 0 }
{ "type": "workspace-list" | "workspace-update" | "workspace-deleted" | "workspace-task-started", "workspaceId": "...", ... }
{ "type": "workspace-inspector" | "workspace-run-result" | "workspace-action-result", "workspaceId": "...", ... }
```

## Responsive Layout

| Breakpoint | Layout |
|------------|--------|
| Desktop (≥1024px) | Server groups with session activity and status in compact rows |
| Tablet (768–1023px) | Same panel; session details open on demand |
| Mobile (<768px) | Single column; server controls and session status stay visible |


## Why "Gate"?

Named after *Steins;Gate* — the anime where messages travel through time to change the worldline. Here, your messages travel through SSH to reach Claude on a remote server, opening a gate between any device and your coding environment.

## License

MIT
