# Gate

Gate is a simple Server → repository groups → Codex sessions panel. Keep it simple.
All AI conversations use Codex's native shared app-server daemon, reached through SSH Unix socket forwarding.
Do not add task/project workflows, a Gate remote runtime, transcript scanners, hook observers, or per-message CLI execution.

## Architecture

- React browser → HTTP actions and WebSocket events → Gate → SSH → Codex shared backend.
- Repository groups are derived from read-only Git metadata over the existing SSH connection, with cwd fallback.
  They are display groups, not persisted project workflows. Project headings reveal history and collapse sessions, including running-only groups.
  Active sessions show by default; search reveals matches without changing the chosen collapsed state.
- Running and Needs you cards filter the monitor in place and reveal matching sessions. App owns this transient filter
  so it survives navigation into a conversation and back. Summary counts remain independent of status/search filters.
- App polls one shared monitor store across navigation. Header Running includes the current thread and marks it Current;
  Needs you lists other waiting/error sessions. Both respect visibility preferences and known connection state;
  transition notices use only known native status, exclude the current thread, and do not open additional conversations.
- Session view state is keyed by server and native thread in browser memory: drafts, model/effort, in-flight actions,
  cached history, and scroll position. Cached approval requests are discarded and native state is refreshed before input.
  Refresh snapshots preserve message items updated while the request was in flight.
- Chats use one compact header. SessionView portals its title/details into AppHeader so live metadata and rename state
  stay with the conversation; return/next attention navigation shares the same row. Directory and theme controls are on demand.
- Codex owns sessions, history, approvals, and execution. Gate stores SSH settings and per-server display preferences.
- Opening a session subscribes to the existing native thread. Sending messages uses `turn/start` or `turn/steer`.
- Image attachments use native `image` data URLs on the same start/steer path; text is optional. Validate formats,
  count and decoded byte limits before any RPC. Draft images stay in per-session browser memory; Codex owns sent history.
  Preserve native `image` URLs and `localImage` paths when rendering user messages. Shell commands reject attachments.
- Inputs prefixed with `!` run a non-interactive shell command over the existing SSH connection in native thread cwd.
  Classify the prefix in backend input handling too; older open pages receive results through existing item events.
  They never start/steer a model turn. Output and exit status stay in per-session browser memory, outside Codex history.
  Commands have a 60-second wait limit and bounded output; uncertain execution is never automatically replayed.
- Local Markdown file/image URLs use a session-scoped HTTP endpoint and SFTP over the existing SSH connection.
  Resolve relative paths against native thread cwd; file contents must never execute on Gate's origin.
- Scrolling upward near the chat top loads one native history page at a time. Prepending anchors the visible message
  before paint; manual loading/retry remains available. Initial bottom positioning must not drain history pages.
  Auto-load once per entry into the top zone; failed requests wait for explicit retry.
  Keep the history control stable during loading, with a delayed progress indicator in reserved space.
- Session renaming uses native `thread/name/set`; names belong to Codex and are shared with terminal clients.
- Model and reasoning pickers read native `model/list`, including supported/default efforts, and pass optional `model`/`effort`
  to `turn/start`. `turn/steer` cannot change either setting. Current values come from native thread metadata.
- Backend disconnect/restart must never restart a turn, resend an uncertain input, or stop Codex.
- Gate is for trusted internal networks and has no authentication.

## Key files

- `server/src/codex-connection.ts`: SSH, native daemon discovery/start, Unix socket forwarding, JSON-RPC correlation.
- `server/src/codex.ts`: native session listing, history, subscriptions, messages, decisions, and interruption.
- `server/src/codex-requests.ts`: offered approval choices and structured question answers.
- `server/src/session-files.ts`: bounded SFTP reads, inert text previews with line anchors, images, and downloads.
- `server/src/types.ts`: shared browser/server response types.
- `server/src/db.ts`: server settings, persistent visibility rules/archives, and one-time preservation of old Gate data.
- `server/src/routes.ts` / `index.ts`: HTTP API and browser event delivery.
- `client/src/components/monitor/SessionMonitor.tsx`: the single server/session panel and creation form.
- `client/src/components/chat/SessionView.tsx`: conversation history, live events, input, and approvals.
- `client/src/components/layout/SessionAttention.tsx`: cross-session status, transient notices, and quick switching.
- `client/src/stores/monitor-store.ts` / `session-view-store.ts`: shared polling and per-conversation view state.
- `client/src/components/monitor/SessionFilters.tsx`: available directories, collapsed blocked-directory list, custom parent paths, and Gate archive restoration.
- `server/src/visibility.ts`: path-boundary matching and session visibility.
- `client/src/components/server/ServerDialog.tsx`: SSH connection settings.

## Commands

```bash
npm install
npm run dev
npm run build
npm test --workspace=server -- --run
npx playwright install chromium
npm run test:ui       # build first
npm run lint --workspace=client
```

Gate is published as `@marukohe/gate`; `bin/gate.js` serves the built app on port 3030.
Data defaults to `~/.gate/gate.db`. Preserve existing user data when removing old mechanisms.

## Working rules

- Read `LESSONS.md` and recent `git log` before changing behavior.
- Commit completed steps with small, meaningful Conventional Commits.
- Run relevant tests, clear compiler warnings, and build broad frontend/server changes before committing.
- Validate real shared-backend behavior, including existing native threads; mocked UI alone does not prove attachment.
- Gate archives are display preferences, not native Codex archives. Filtering/archiving must not send Codex mutations.
- Never kill a shared backend to test reconnection. Close only Gate's own connection or an isolated test fixture.
- Preserve passwords on an unchanged edit and never return them in browser API responses or logs.
- Keep `README.md`, `README_CN.md`, and these instructions consistent with shipped behavior.
- Keep `docs/` for current usage and architecture. Do not commit process journals, plans, or validation reports.
- Put optional scratch notes in `.agent-notes/` (ignored); report progress in conversation and commit bodies.
- Keep `LESSONS.md` short and actionable. Update existing lessons instead of appending a diary.
- `AGENTS.md` is a symlink to this file. Preserve the link.
