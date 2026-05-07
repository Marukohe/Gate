# AGENTS.md / CLAUDE.md

This file provides guidance to coding agents, including Claude Code, when working with code in this repository.

## Project Overview

Gate is a responsive web app for "vibe coding" — chat with AI coding CLIs (Claude Code, OpenAI Codex) running on remote servers via SSH, from any device (phone, tablet, desktop). Internal network deployment only, no auth.

## Architecture

```
Browser (React) <--WebSocket--> Node.js Backend <--SSH--> Remote Server (CLI tools)
                                     |
                              Provider Layer
                              Claude  Codex  ...
```

- **Monorepo** with npm workspaces: `client/` and `server/`
- Backend parses CLI terminal output into structured messages via provider-specific parsers and streams them to the frontend via WebSocket
- Frontend renders parsed messages as chat bubbles with markdown, syntax highlighting, collapsible tool cards, diff views, and plan panels
- Plan management extracts markdown checklists from chat into a dedicated panel for tracking/editing
- Workspace management treats repositories as first-class work units with status, goal, primary session, branch/worktree start options, a simplified overview, an on-demand fixed inspector, repo scripts, one-shot terminal commands, and delivery actions

## Tech Stack

- **Client**: Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui + Zustand
- **Server**: Express 5 + ws + ssh2 + better-sqlite3 + TypeScript
- **Testing**: Vitest (server-side)

## Commands

```bash
# Development (both client and server)
npm run dev

# Client only (port 5173, proxies /api and /ws to server)
npm run dev:client

# Server only (port 3030)
npm run dev:server

# Build client and server
npm run build

# Run all server tests
cd server && npx vitest run

# Type check server
cd server && npx tsc --noEmit
```

## Deployment

Published as `@marukohe/gate` on npm. Users install globally:

```bash
npm i -g @marukohe/gate
gate                        # starts on http://0.0.0.0:3030
gate --port 8080            # custom port
gate --data-dir /custom     # custom data directory (default: ~/.gate)
```

Data is stored in `~/.gate/gate.db` by default.

## Key Modules

**Server:**
- `server/src/db.ts` — SQLite layer for servers, sessions, messages, workspaces, and provider session maps
- `server/src/ssh-manager.ts` — SSH connection pool, CLI channel management, and command execution via ssh2
- `server/src/ssh-browse.ts` — Remote directory browsing over SSH
- `server/src/git-utils.ts` — Git command helpers
- `server/src/repo-scripts.ts` — Optional `gate.json` parser for `setup`, `run`, and `test` commands
- `server/src/workspace-actions.ts` — Deterministic workspace delivery action state updates
- `server/src/workspace-inspector.ts` — Workspace inspector snapshot builder
- `server/src/ws-handler.ts` — WebSocket server for chat, provider switching, workspace CRUD, start flow, scripts, actions, and terminal exec results
- `server/src/routes/servers.ts` — REST CRUD for server configurations and sessions
- `server/src/providers/types.ts` — CLIProvider interface, OutputParser abstract class, ParsedMessage type
- `server/src/providers/registry.ts` — Provider registration and lookup
- `server/src/providers/claude/` — Claude Code provider, parser, transcript support, command building
- `server/src/providers/codex/` — OpenAI Codex provider, parser, transcript support, tool utils, command building

**Client:**
- `client/src/App.tsx` — Top-level route state for home, workspace overview, and chat sessions
- `client/src/hooks/use-websocket.ts` — Singleton WebSocket connection with auto-reconnect and queued workspace actions
- `client/src/stores/` — Zustand stores: server, session, chat, git, plan, plan-mode, workspace, ui
- `client/src/components/layout/` — AppShell, Sidebar, TopBar; handles desktop fixed panels and mobile sheets
- `client/src/components/home/` — CommandCenter workspace board
- `client/src/components/workspace/` — WorkspaceHome, WorkspaceStart, WorkspaceInspector, WorkspaceActionBar, AddWorkspaceDialog
- `client/src/components/changes/` — ChangesPanel, FileItem, CreatePRDialog
- `client/src/components/diff/` — DiffView, DiffFile, diff parser
- `client/src/components/chat/` — ChatView, SessionBar, MessageBubble, ChatInput, provider/session dialogs, tool rendering
- `client/src/components/plan/` and `client/src/components/plan-mode/` — Plan panels and plan-mode interaction
- `client/src/lib/plan-parser.ts` — Markdown checklist ↔ PlanStep conversion

## WebSocket Protocol

Client sends:
- `{ type: 'connect'|'input'|'interrupt'|'disconnect', serverId, sessionId?, text? }`
- `{ type: 'switch-provider', serverId, sessionId, provider }`
- `{ type: 'reset-conversation'|'resume-cli-session', serverId, sessionId, claudeSessionId? }`
- `{ type: 'list-cli-sessions', serverId, workingDir, provider }`
- `{ type: 'exec', serverId, sessionId, command, workspaceId?, terminal?, requestId? }`
- `{ type: 'list-workspaces'|'create-workspace'|'update-workspace'|'delete-workspace', workspaceId?, ... }`
- `{ type: 'start-workspace-task', workspaceId, goal, provider?, branchMode?, branchName?, worktreeMode?, worktreePath? }`
- `{ type: 'fetch-workspace-inspector'|'run-workspace-script'|'run-workspace-action', workspaceId, ... }`

Server sends:
- `{ type: 'message'|'status'|'history'|'history-prepend'|'sessions', serverId, ... }`
- `{ type: 'git-info'|'git-status'|'git-diff'|'pr-info', serverId, sessionId, ... }`
- `{ type: 'cli-sessions', serverId, sessions }`
- `{ type: 'exec-result', workspaceId, requestId, stdout, stderr, exitCode, ... }`
- `{ type: 'workspace-list'|'workspace-update'|'workspace-deleted'|'workspace-task-started', workspaceId, ... }`
- `{ type: 'workspace-inspector'|'workspace-run-result'|'workspace-action-result'|'workspace-error', workspaceId, ... }`

## Responsive Breakpoints

- Desktop (>=1024px): sidebar + workspace/chat + on-demand fixed inspector
- Tablet (768-1023px): workspace/chat fullwidth, sidebar and inspector as drawers
- Mobile (<768px): fullscreen workspace/chat, sidebar/inspector as bottom sheets

## Best Practices

1. Use git frequently and meaningfully
2. Follow **Conventional Commits**
3. Keep `README.md`, `README_CN.md`, `CLAUDE.md`, and `AGENTS.md` in sync when architecture, commands, or workflows change
4. Fix compiler warnings
5. Keep a clean, layered project structure
6. Write comments that explain *why*, not *what*

## Before Starting Work

1. Review recent history:
   ```bash
   git log --oneline --stat
   git show --summary --stat --name-only <commit>
   git diff <commit> <commit>
   ```
2. Understand existing design decisions before changing behavior
3. For large tasks, commit incrementally with clear messages

## Before Saving Changes

Always:

1. Clear compiler warnings
2. Ensure relevant tests pass
3. Verify the project builds (`npm run build`) for broad frontend/server changes
4. Check changes with `git status`
5. Commit completed changes with a small, reviewable Conventional Commit
