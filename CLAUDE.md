# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gate is a responsive web app for "vibe coding" — chat with AI coding CLIs (Claude Code, OpenAI Codex) running on remote servers via SSH, from any device (phone, tablet, desktop). Internal network deployment only, no auth.

## Architecture

```
Browser (React) <--WebSocket--> Node.js Backend <--SSH--> Remote Server (CLI tools)
                                     │
                              Provider Layer
                              ┌──────┼──────┐
                              Claude  Codex  ...
```

- **Monorepo** with npm workspaces: `client/` and `server/`
- Backend parses CLI terminal output into structured messages via provider-specific parsers and streams them to the frontend via WebSocket
- Frontend renders parsed messages as chat bubbles with markdown, syntax highlighting, and collapsible tool call cards
- Plan management: extract markdown checklists from chat into a dedicated panel for tracking/editing

## Tech Stack

- **Client**: Vite + React + TypeScript + Tailwind CSS + shadcn/ui + zustand
- **Server**: Express + ws (WebSocket) + ssh2 + better-sqlite3 + strip-ansi
- **Testing**: Vitest (server-side)

## Commands

```bash
# Development (both client and server)
npm run dev

# Client only (port 5173, proxies /api and /ws to server)
npm run dev:client

# Server only (port 3030)
npm run dev:server

# Run all server tests
cd server && npx vitest run

# Run a specific test file
cd server && npx vitest run src/__tests__/providers/claude/parser.test.ts

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

Data (SQLite DB) is stored in `~/.gate/gate.db` by default, shared between dev and production modes.

To publish a new version:

```bash
npm version patch           # bump version
npm publish --access public # build + publish to npm
```

## Key Modules

**Server:**
- `server/src/db.ts` — SQLite layer: servers, sessions, messages tables (with chatStartedAt, providerSessionMap)
- `server/src/ssh-manager.ts` — SSH connection pool + CLI channel management via ssh2
- `server/src/ssh-browse.ts` — Remote directory browsing via SSH
- `server/src/ws-handler.ts` — WebSocket server: bridges browser clients to SSH sessions, handles provider switching, conversation reset/resume
- `server/src/routes/servers.ts` — REST CRUD for server configurations
- `server/src/providers/types.ts` — CLIProvider interface, OutputParser abstract class, ParsedMessage type
- `server/src/providers/registry.ts` — Provider registration and lookup
- `server/src/providers/claude/` — Claude Code CLI provider (parser, transcript, command building)
- `server/src/providers/codex/` — OpenAI Codex CLI provider (parser, transcript, tool-utils, command building)

**Client:**
- `client/src/stores/` — Zustand stores: server-store, session-store, chat-store, plan-store, plan-mode-store, ui-store
- `client/src/hooks/use-websocket.ts` — Singleton WebSocket connection with auto-reconnect
- `client/src/components/layout/` — AppShell (3-column responsive), Sidebar, TopBar
- `client/src/components/chat/` — ChatView, MessageBubble, ToolCallCard, ToolActivityBlock, CodeBlock, ChatInput, SessionBar, ProviderSwitcher, CreateSessionDialog, ResumeChatDialog, BranchSwitcher
- `client/src/components/plan/` — PlanPanel (view/edit modes), PlanStepItem
- `client/src/components/plan-mode/` — PlanModeOverlay, PlanModeQuestion, PlanModeThinking, PlanModeDone
- `client/src/components/server/` — ServerDialog
- `client/src/lib/plan-parser.ts` — Markdown checklist ↔ PlanStep[] conversion

## WebSocket Protocol

Client sends: `{ type: 'connect'|'input'|'disconnect', serverId, sessionId?, text? }`
Client sends: `{ type: 'switch-provider', serverId, sessionId, provider }`
Client sends: `{ type: 'reset-conversation', serverId, sessionId }`
Client sends: `{ type: 'resume-cli-session', serverId, sessionId, claudeSessionId }`
Client sends: `{ type: 'list-cli-sessions', serverId, workingDir, provider }`
Server sends: `{ type: 'message'|'status'|'history', serverId, ... }`
Server sends: `{ type: 'cli-sessions', serverId, sessions }`

## Responsive Breakpoints

- Desktop (>=1024px): 3-column — sidebar (64px) + chat (flex) + plan panel (320px)
- Tablet (768-1023px): Chat fullwidth, sidebar and plan as drawers
- Mobile (<768px): Fullscreen chat, sidebar/plan as full-screen sheet overlays

## Best Practices

1. Use git frequently and meaningfully
2. Follow **Conventional Commits**
3. Keep `README.md`, `README_CN.md`, `CLAUDE.md`, `SPEC.md`, `AGENT.md`, and `TODO.md` up to date
   - **README has two languages**: `README.md` (English) and `README_CN.md` (Chinese). When updating one, always sync the other.
4. Fix **all compiler warnings**
5. Keep a clean, layered project structure
6. Write high-quality comments that explain *why*, not *what*

## Before Starting Work

1. Review recent history:
   ```bash
   git log [--oneline] [--stat] [--name-only] # Show brief/extended history
   git show [--summary] [--stat] [--name-only] <commit> # Show brief/extended history of a commit
   git diff <commit> <commit> # Compare two different commits
   git checkout <commit> # Checkout and inspect all the details of a commit
   ```
2. Understand existing design decisions before changing behavior
3. For large tasks, commit incrementally with clear messages

## Before Saving Changes

ALWAYS:

1. Clear all compiler warnings
2. Format code with `clang-format`
3. Ensure all tests pass (timeouts excepted)
4. Verify the dev server starts without errors (`npm run dev`)
5. Check changes with `git status`
6. Auto-commit after each completed change (small, reviewable commits)
7. Use Conventional Commit messages:

```text
<type>[optional scope]: <title>

<body>

[optional footer]
```

* Title ≤ 50 characters
* Body explains intent and design impact
