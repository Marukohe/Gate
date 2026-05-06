# Phase A: Workspace Abstraction + Command Center — Design

**Status:** Baseline implemented; retained as Phase A foundation
**Date:** 2026-04-30
**Phase:** A (foundation for the multi-agent / multi-workspace developer workstation roadmap)
**Predecessors:** P0–P2 conductor-inspired work (sessions, worktrees, checkpoints, agent-team review, todo-gated PR)
**Follow-up:** `docs/superpowers/specs/2026-05-06-helmor-aligned-workspace-surface-design.md`

---

## Goal

Promote "remote git repository" to a first-class concept (`Workspace`) in Gate, replace the server-centric sidebar with a workspace-centric one, and introduce a Command Center landing page that aggregates running agents and workspace state. This is the foundation that later phases (B agent orchestration, C skills, D terminal/preview, E scheduled tasks) will attach to.

## Current Baseline

Phase A established the repository/workspace/session relationship and the first workspace-centric routes. It intentionally remains a foundation layer: workspaces are still mostly containers for sessions. The next product step is Phase A.1, which promotes a workspace into a task/delivery surface with status grouping, a start composer, a workspace inspector, and delivery actions.

## Non-Goals (Phase A)

- Workspace rename / icon / color editor — auto-derive name from repo basename for v1; editor ships in Phase A.1 alongside settings page
- Cross-workspace search / filter
- Drag-and-drop assignment of loose sessions
- Workspace archive / soft-delete (use real delete)
- "All workspaces on this server" view — server view is implicit in workspace metadata only
- Skills, scheduled tasks, terminal tabs, artifact previews (later phases)

## Conceptual Model

```
Server (existing — SSH connection target)
 └─ Workspace (new — a remote git repository)
     └─ Session (existing — one CLI process; worktree-or-main checkout)
```

- **Workspace identity** = `(server_id, repo_canonical_path)` where `repo_canonical_path` is the main worktree path obtained via `git rev-parse --path-format=absolute --git-common-dir` then resolving its parent. All worktrees of the same repository resolve to the same workspace.
- A **session** belongs to at most one workspace. `sessions.workspace_id` is **nullable** — `NULL` denotes a "loose" session (non-git working dir, or not yet detected post-migration).
- Worktrees are surfaced **as ordinary sessions** under their parent workspace in the sidebar; an icon badge (e.g. branching glyph) distinguishes worktree-rooted sessions from main-checkout sessions.

## Data Model Changes

### New table: `workspaces`

| Column                       | Type     | Notes                                                                 |
| ---------------------------- | -------- | --------------------------------------------------------------------- |
| `id`                         | TEXT PK  | UUID                                                                  |
| `server_id`                  | TEXT FK  | references `servers(id)` ON DELETE CASCADE                            |
| `repo_path`                  | TEXT     | absolute path of the main worktree on the remote                      |
| `remote_url`                 | TEXT     | `remote.origin.url` if present, else NULL                             |
| `default_branch`             | TEXT     | resolved on creation (HEAD / main / master), updatable                |
| `name`                       | TEXT     | initial value = `basename(repo_path)`; user-editable in later phases  |
| `auto_open_last_session`     | INTEGER  | 0/1 boolean; default 0                                                |
| `created_at`                 | INTEGER  | epoch ms                                                              |
| `updated_at`                 | INTEGER  | epoch ms                                                              |

**Unique constraint:** `(server_id, repo_path)`.

### Modified table: `sessions`

- Add column `workspace_id TEXT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.
- Add column `workspace_probed_at INTEGER NULL` — epoch ms of the last git probe attempt; used to skip re-probing sessions whose `workingDir` has already been confirmed non-git.
- Migration: add both columns with default `NULL`; existing rows are unaffected.
- Cascade delete: deleting a workspace deletes its sessions (confirmed in brainstorm).

## Lazy Migration Strategy

No upfront migration job, no migration wizard.

1. On every successful `connect` (existing path in `ws-handler.ts`), if the session has `workspace_id IS NULL`, run a probe in `ssh-manager` against the session's `workingDir`:
   - `git rev-parse --show-toplevel` → fail ⇒ mark session as probed-non-git, leave `workspace_id = NULL`
   - `git rev-parse --git-common-dir` → resolve to main worktree path; this is `repo_canonical_path`
   - `git config --get remote.origin.url` (best-effort)
   - `git symbolic-ref refs/remotes/origin/HEAD` → fall back to current branch on detached/missing — this is `default_branch`
2. UPSERT into `workspaces` on `(server_id, repo_canonical_path)`; reuse if exists.
3. Set `sessions.workspace_id = workspaces.id`; emit a `workspace-update` push so the client moves the session in the sidebar without reload.
4. To prevent re-probing on every connect, add a `sessions.workspace_probed_at INTEGER NULL` column; skip probe when `workspace_id IS NOT NULL OR workspace_probed_at IS NOT NULL`. User can force re-probe via "Detect workspace" action on a loose session (Phase A.1).

## WebSocket Protocol Additions

Client → server:

- `list-workspaces` `{ }` — list all workspaces across all servers (with aggregation, see below)
- `create-workspace` `{ serverId, repoPath, name? }` — explicit creation; validates git, populates remote/default_branch
- `delete-workspace` `{ workspaceId }` — cascades to sessions
- `update-workspace` `{ workspaceId, name?, autoOpenLastSession?, defaultBranch? }`

Server → client:

- `workspace-list` `{ workspaces: WorkspaceWithAggregates[] }` — response to `list-workspaces`
- `workspace-update` `{ workspace: WorkspaceWithAggregates }` — push when a workspace is created, deleted (`{ workspaceId, deleted: true }`), or its aggregates change materially
- `session-update` `{ session }` — extend existing session push to carry the new `workspace_id` after migration

`WorkspaceWithAggregates` shape:

```ts
{
  id, serverId, repoPath, remoteUrl, defaultBranch, name,
  autoOpenLastSession, createdAt, updatedAt,
  // aggregates (computed at request time):
  activeSessionCount: number,    // from in-memory ssh-manager
  totalSessionCount: number,     // count(sessions where workspace_id = this.id)
  dirtyFileCount: number | null, // from existing cached git status; null if cache cold
  lastActivityAt: number | null, // max message timestamp across sessions; null if no messages
}
```

Re-aggregation cadence:

- `activeSessionCount` is reported by the server as a snapshot of `ssh-manager` active channels in thinking/tool_call state at request time. The client supplements this with live `agentStatus` updates from existing per-session message streams; the live values take precedence when they disagree.
- The Command Center's active-runs strip is rendered from the client's `agentStatus` store directly — no new protocol — since `agentStatus` already updates via existing `parsed-message` events for any session with an active channel.
- `dirtyFileCount` / `lastActivityAt` recomputed on workspace card focus and when their underlying events fire (existing git-status refresh, new message). A debounced `workspace-update` push avoids storm during heavy activity.

## Backend Modules

### `server/src/db.ts`

- Add `workspaces` table + interface `Workspace`
- Add CRUD: `listWorkspaces()`, `getWorkspace(id)`, `getWorkspaceByPath(serverId, repoPath)`, `upsertWorkspace(...)`, `updateWorkspace(...)`, `deleteWorkspace(id)` (cascade)
- Extend `sessions` queries to expose `workspace_id` and `workspace_probed_at`; add `setSessionWorkspace(sessionId, workspaceId)`, `markSessionProbed(sessionId)`
- Add `aggregateWorkspace(workspaceId)` returning `{ totalSessionCount, dirtyFileCount, lastActivityAt }`

### `server/src/ssh-manager.ts`

- Add `probeGitRepo(serverId, channelId, workingDir)` → `{ canonicalPath, remoteUrl, defaultBranch } | null`
- Reuses existing `execCommand` plumbing; runs the four git commands in one batched `bash -lc 'set -e; ...'` call to minimize round-trips

### `server/src/ws-handler.ts`

- New cases: `list-workspaces`, `create-workspace`, `delete-workspace`, `update-workspace`
- In `connect` handler, after channel is up, schedule probe-and-migrate if `workspace_id IS NULL AND workspace_probed_at IS NULL`
- After probe, if a workspace is created/updated, emit `workspace-update` to all clients on this connection
- Extend the `ClientMessage` union type for the new message kinds (matches the pattern already used)

### `server/src/routes/workspaces.ts` (new, optional)

- REST CRUD parallel to WS, used by the "Add workspace" dialog when SSH browse needs HTTP semantics. If the dialog can be done purely over WS (it can — `ssh-browse` already uses WS), skip this route.

## Frontend Modules

### New: `client/src/stores/workspace-store.ts` (zustand)

```ts
{
  workspaces: Record<string, WorkspaceWithAggregates>,
  activeWorkspaceId: string | null,
  setWorkspaces, upsertWorkspace, removeWorkspace,
  setActiveWorkspace, getWorkspaceForSession(sessionId)
}
```

### Modified: `client/src/stores/session-store.ts`

- Sessions gain `workspaceId` field
- Add selector `sessionsByWorkspace(workspaceId)`; selector `looseSessionsByServer(serverId)` for the footer group

### Sidebar restructure (`client/src/components/layout/Sidebar.tsx`)

Top-level becomes a flat list of workspaces (sorted: pinned later, then by `lastActivityAt` desc). Each workspace row:

- Name + tiny server tag (e.g. `· devbox`)
- Expand chevron → reveals sessions list (existing per-session row markup reused)
- Active-agent dot at workspace level when ≥1 child session is active

Footer group (rendered last, collapsed by default): **"Loose sessions"** containing per-server subgroups for sessions with `workspaceId IS NULL`. Click a server subgroup to expand its loose sessions.

"Add workspace" button at the top of the workspace list; "New session" remains accessible **inside a workspace's expanded section**.

### Command Center (new: `client/src/components/home/CommandCenter.tsx`)

Default route when no session is active. Two zones, top-down:

1. **Active runs strip** — horizontal list/chips of every session whose `agentStatus` is `thinking` or `tool_call`, grouped subtly by workspace. Click jumps to that session's chat.
2. **Workspace grid** — cards in a responsive grid. Card content:
   - Name, server tag
   - Default branch (small badge)
   - Active session count (green dot + number)
   - Total sessions (subtle)
   - Dirty file count (only when > 0)
   - Last activity (relative, e.g. "12m ago")
   - Click card → navigates to that workspace's home page

Empty state when no workspaces: a CTA card "Add your first workspace".

### Workspace home (new: `client/src/components/workspace/WorkspaceHome.tsx`)

Default view when a workspace is selected and it has no `auto_open_last_session` (or the user hasn't opted in):

- Header: workspace name, server, default branch, repo path (mono), remote_url link
- "New session" button (primary)
- **Sessions section**: list of all sessions in this workspace; columns: name, branch (incl. worktree path if applicable), last activity, active state indicator
- **Worktrees section**: list of distinct worktree paths in use (read from sessions); each shows which session(s) currently bind to it
- **Settings**: a small settings bar at the bottom — for v1 this only has the `auto_open_last_session` toggle. (Rename / default branch override deferred to A.1.)

If `auto_open_last_session` is on, clicking the workspace in the sidebar still selects the workspace, but the main view jumps directly to the most recently active session's chat (existing chat view).

### Add workspace dialog (new: `client/src/components/workspace/AddWorkspaceDialog.tsx`)

Three steps in one dialog:

1. **Pick server** (dropdown of registered servers)
2. **Pick repo root** (uses existing `ssh-browse`; shows whether the candidate dir is a git repo with a green/red indicator)
3. **Confirm + name** (auto-fills `basename(repo_path)`; user can edit)

On confirm, sends `create-workspace`. On success, navigates to the new workspace's home.

### Create session dialog changes (`client/src/components/chat/CreateSessionDialog.tsx`)

- When invoked from a workspace context, the server is preselected and the working dir defaults to `workspace.repo_path` (or a worktree under it) — the workingDir field can be hidden entirely or shown as read-only/advanced.
- When invoked from the **Loose sessions** footer (existing flow path), show the legacy "pick server + workingDir" form.

## UX Flows

### First-time install
1. App opens → Command Center empty state → "Add your first workspace" CTA → AddWorkspaceDialog → user picks server + repo → workspace created → home page → "New session" → familiar chat.

### Existing user upgrade
1. App opens → Command Center empty (workspaces list is empty initially).
2. Sidebar Loose sessions footer shows all old sessions grouped by server.
3. User clicks a loose session → connects → on next successful `connect`, probe runs → workspace auto-created, session moves into it → sidebar updates live → user sees the migration happen visually.
4. After running through their active sessions over a few days, all migratable sessions land in workspaces; non-git ones remain loose forever (correct).

### Delete workspace
- Confirmation dialog lists sessions that will be deleted (count + names). Destructive style. After confirm, cascade delete.

### Worktree session
- Created via existing P1 flow (`agent-team` / parallel agents already create worktrees on remote). The session that points at a worktree path is detected during probe; its workspace_id resolves to the same workspace as the main checkout because both share `git-common-dir`. Sidebar renders it as an ordinary session row with a worktree icon badge.

## Testing Plan

Server-side (Vitest):

- `db.test.ts`: workspace CRUD, cascade delete, unique constraint, session.workspace_id linkage
- `ssh-manager.test.ts`: `probeGitRepo` happy path, non-git path, worktree path resolves to main repo path, missing remote, detached HEAD
- `ws-handler.test.ts`: create / list / update / delete workspace messages; lazy migration on connect; `workspace-update` push fan-out

Client-side: rely on existing manual / Vite dev runs. Key smoke checks:

- Sidebar renders empty workspace list + loose footer when DB is fresh
- Adding a workspace populates sidebar without reload
- Creating a session inside a workspace inherits server / repo path
- Deleting a workspace removes sessions from sidebar
- Command Center active-runs strip updates as agents start/finish
- Mobile: workspace list collapses into existing sheet drawer (responsive breakpoints unchanged)

## Risks & Trade-offs

- **Probe latency on first connect**: 4 git commands batched in one `bash -lc` adds ~100–300ms to the first connect. Acceptable; runs once per session.
- **Workspace identity stability**: if a user moves a repo on the remote (different path), Gate sees it as a different workspace. The (server_id, repo_path) primary key makes this explicit; surfacing a "merge workspaces" tool can be a Phase A.1 follow-up if it becomes a real complaint.
- **Migration doesn't happen for sessions the user never reopens**: those stay loose forever. Acceptable — they're effectively dead sessions; we don't proactively SSH for them.
- **Cascade delete is destructive**: mitigated by the confirmation dialog listing affected sessions. No undo.

## Out-of-scope follow-ups (queue for A.1 or later phases)

- Workspace settings page proper: rename, default branch override, color/icon, archive
- "Detect workspace" action on a loose session (force re-probe)
- "Move session to workspace" UI for relocating loose sessions without reconnecting
- Pinning workspaces in the sidebar; sort/filter
- Server-level overview ("show all workspaces on this server, including health")
- Aggregation push optimizations (currently re-aggregates on focus + event; may need server-side caching at scale)
