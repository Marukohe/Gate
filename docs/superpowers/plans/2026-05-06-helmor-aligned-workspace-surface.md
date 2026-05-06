# Phase A.1: Helmor-Aligned Workspace Surface Implementation Plan

> **For agentic workers:** Implement task-by-task with small commits. Keep Phase A behavior working while changing the product surface.

**Goal:** Turn the Phase A workspace foundation into a Helmor-aligned workspace surface: status-grouped Command Center, Workspace Start composer, workspace-aware inspector, and delivery actions.

**Spec:** `docs/superpowers/specs/2026-05-06-helmor-aligned-workspace-surface-design.md`

---

## File Map

### Likely new files

- `client/src/components/workspace/WorkspaceStart.tsx`
- `client/src/components/workspace/WorkspaceInspector.tsx`
- `client/src/components/workspace/WorkspaceStatusMenu.tsx`
- `client/src/components/workspace/WorkspaceActionBar.tsx`
- `server/src/workspace-actions.ts`
- `server/src/repo-scripts.ts`

### Likely modified files

- `server/src/db.ts`
- `server/src/ws-handler.ts`
- `server/src/ssh-manager.ts`
- `client/src/stores/workspace-store.ts`
- `client/src/stores/session-store.ts`
- `client/src/hooks/use-websocket.ts`
- `client/src/components/home/CommandCenter.tsx`
- `client/src/components/workspace/WorkspaceHome.tsx`
- `client/src/components/layout/AppShell.tsx`
- `client/src/components/changes/ChangesPanel.tsx`
- `client/src/components/plan/PlanPanel.tsx`
- `client/src/App.tsx`
- `README.md`
- `README_CN.md`

---

## Task 1: Workspace Status and Archive Foundation

**Goal:** Add the minimum persisted state needed for a work-queue Command Center.

- [x] Add `WorkspaceStatus` type and columns: `status`, `goal`, `pinnedAt`, `archivedAt`, `primarySessionId`, `prUrl`, `prState`.
- [x] Add `sessions.isHidden`, `sessions.actionKind`, and `sessions.unreadCount`.
- [x] Extend DB CRUD and `WorkspaceWithAggregates`.
- [x] Add WS messages: `set-workspace-status`, `pin-workspace`, `archive-workspace`, `restore-workspace`.
- [x] Update workspace store and websocket handlers.
- [x] Add server tests for defaults, status update, pinning, archive/restore, and hidden session filtering.

Verification:

```bash
cd server && npx vitest run
cd server && npx tsc --noEmit
npx tsc --noEmit -p client/tsconfig.json
```

Commit:

```bash
git commit -m "feat(workspace): add status and archive metadata"
```

## Task 2: Status-Grouped Command Center

**Goal:** Replace the Phase A workspace grid with a compact grouped work queue.

- [x] Group workspaces by `Pinned`, `In Progress`, `Review`, `Backlog`, `Done`, `Archived/Canceled`.
- [x] Render each workspace as a dense row/card with status, server, branch, active run, dirty count, PR state, goal/session title, and last activity.
- [x] Add row actions for status, pin, archive, and restore.
- [x] Keep Active Runs, but make it secondary to the workspace groups.
- [ ] Verify mobile sheet/card layout.

Verification:

```bash
npx tsc --noEmit -p client/tsconfig.json
npm run dev:client
```

Commit:

```bash
git commit -m "feat(command-center): group workspaces by delivery status"
```

## Task 3: Workspace Start Composer

**Goal:** Make starting work the primary empty/workspace-home experience.

- [x] Create `WorkspaceStart.tsx` with prompt textarea and provider selector.
- [ ] Add branch picker and worktree mode selector.
- [x] Add `start-workspace-task` WS message.
- [x] On submit, create the primary session, set `workspace.goal`, set status `in-progress`, and send the goal as input.
- [x] Keep the existing session/worktree list as secondary content below the composer or in a compact tab.
- [x] Ensure existing `autoOpenLastSession` behavior still works.

Verification:

```bash
npx tsc --noEmit -p client/tsconfig.json
cd server && npx tsc --noEmit
```

Commit:

```bash
git commit -m "feat(workspace): add start composer for new work"
```

## Task 4: Workspace Inspector

**Goal:** Make the right panel workspace-aware instead of only active-session-aware.

- [ ] Create `WorkspaceInspector.tsx` with tabs: Changes, Plan, Run, Terminal.
- [ ] Reuse `ChangesPanel` and `PlanPanel` where possible, but pass workspace context.
- [ ] Add `fetch-workspace-inspector` response shape for changes, PR state, scripts, and action status.
- [ ] Make `AppShell` show inspector data for the selected workspace, even before a chat session is active.
- [ ] Preserve existing mobile bottom sheet behavior.

Verification:

```bash
npx tsc --noEmit -p client/tsconfig.json
npm run dev:client
```

Commit:

```bash
git commit -m "feat(workspace): add workspace inspector panel"
```

## Task 5: Repo Scripts and Run Tab

**Goal:** Provide a simple remote script surface without building a full IDE.

- [ ] Add `server/src/repo-scripts.ts` to read optional `gate.json`.
- [ ] Support `setup`, `run`, and `test` commands.
- [ ] Add WS action for running a configured script in the workspace root.
- [ ] Stream command output into Run tab state.
- [ ] Detect URLs in output and expose an "Open" action when possible.

Verification:

```bash
cd server && npx vitest run
cd server && npx tsc --noEmit
npx tsc --noEmit -p client/tsconfig.json
```

Commit:

```bash
git commit -m "feat(workspace): run repo scripts from inspector"
```

## Task 6: Delivery Actions

**Goal:** Attach commit/push/PR workflow to the workspace.

- [ ] Add `server/src/workspace-actions.ts` for deterministic actions: commit, push, create PR, open PR.
- [ ] Add `run-workspace-action` WS handler.
- [ ] Add hidden action sessions for AI-assisted review/fix actions only.
- [ ] Update workspace status automatically: create/open PR -> `review`, merged/done -> `done`.
- [ ] Surface action failures in the inspector.
- [ ] Add workspace action buttons in `WorkspaceActionBar`.

Verification:

```bash
cd server && npx vitest run
cd server && npx tsc --noEmit
npx tsc --noEmit -p client/tsconfig.json
```

Commit:

```bash
git commit -m "feat(workspace): add delivery actions"
```

## Task 7: Polish, Docs, and Regression

**Goal:** Make the new flow coherent and document the product model.

- [ ] Update `README.md` and `README_CN.md` with workspace/status/inspector concepts.
- [ ] Update `CLAUDE.md` key modules if new modules were added.
- [ ] Smoke desktop/tablet/mobile layouts.
- [ ] Run server tests and type checks.
- [ ] Start `npm run dev` and verify the app boots.
- [ ] Check `git status` and commit final doc/polish changes.

Verification:

```bash
cd server && npx vitest run
cd server && npx tsc --noEmit
npx tsc --noEmit -p client/tsconfig.json
npm run dev
```

Commit:

```bash
git commit -m "docs(workspace): document workspace delivery workflow"
```

## Acceptance Criteria

- Command Center reads as a work queue, not a generic project grid.
- Opening a workspace leads with a "what should we build" composer unless auto-open is enabled.
- Workspace status, dirty files, PR state, and active runs are visible without opening every chat.
- Commit/push/create PR actions are reachable from the workspace inspector.
- Hidden action sessions do not clutter normal session lists.
- Mobile users can inspect changes and trigger core actions from sheets.
