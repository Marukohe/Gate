# Gate

Gate is a simple Server → repository groups → native sessions panel. Keep it simple.
Codex uses its native shared app-server daemon through SSH Unix socket forwarding. Antigravity (agy) uses a persistent
ACP stdio connection over SSH. Add tools through the backend contract and registration, not protocol branches in the UI.
Do not add task/project workflows, a Gate remote runtime, transcript scanners, hook observers, or per-message CLI execution.

## Architecture

- React browser → HTTP actions and WebSocket events → Gate backend adapter → SSH → native tool.
- HTTP routes use `AgentService`; protocol implementations satisfy `AgentBackend`. Connection settings select the tool
  and executable. SSH, SFTP, repository lookup and direct shell execution live outside tool-specific transports.
- The homepage groups tool connections by SSH host and port into one server card, using the oldest connection's name.
  Merge repository groups across tools, label session rows and attention lists with tool tags, and count server groups.
  Keep connection ID plus native session ID on every action, draft, cache and row key; native IDs can collide across tools.
  New-session, settings and filter dialogs select a tool within the existing server entry. Visibility settings remain scoped
  to their original connections; regrouping must not migrate or combine saved exclusions/archives.
- New connections offer local `~/.ssh/config` hosts first, then manual entry. Discover concrete aliases through Includes;
  use local `ssh -G` to resolve fields. Import an editable snapshot without modifying SSH config or exposing key contents.
  Do not silently import proxy/certificate configurations as direct connections. Config import is independent of the tool.
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
- Tools own sessions, history, approvals, and execution. Gate stores connection/tool settings and display preferences.
- Codex subscribes to native threads and sends via `turn/start` or `turn/steer`. ACP lists/loads native sessions and uses
  `session/prompt`, updates, offered permission choices, and `session/cancel`. Never infer external live status from saved
  history. agy shows saved sessions without claiming terminal takeover; only Gate-initiated turns have known live state.
  ACP may stop its own work when its connection closes; never close another client's process or automatically replay input.
- UI controls follow per-session capabilities. agy does not expose rename or steering. ACP config options provide its
  model/effort choices. A changed history version replaces cached items after replay when native message IDs are unavailable.
  agy currently omits images from history replay; disclose this limitation without adding a second persistent message store.
- Image attachments use native Codex `image` data URLs or ACP image content blocks; text is optional. Validate formats,
  count and decoded byte limits before any RPC. Draft images stay in per-session browser memory; tools own sent history.
  Preserve native `image` URLs and `localImage` paths when rendering user messages. Shell commands reject attachments.
  Conversation-level paste accepts image clipboard items/files without duplicate attachments; preserve normal text paste
  and leave other editors/dialogs alone. Paste adds a draft and focuses the composer, never submits it.
- Inputs prefixed with `!` run a non-interactive shell command over the existing SSH connection in native thread cwd.
  Classify the prefix in backend input handling too; older open pages receive results through existing item events.
  They never start/steer a model turn. Output and exit status stay in per-session browser memory, outside native history.
  Commands have a 60-second wait limit and bounded output; uncertain execution is never automatically replayed.
- Local Markdown file/image URLs use a session-scoped HTTP endpoint and SFTP over the existing SSH connection.
  Resolve relative paths against native thread cwd; file contents must never execute on Gate's origin.
- Scrolling upward near the chat top loads one native history page at a time. Prepending anchors the visible message
  before paint; manual loading/retry remains available. Initial bottom positioning must not drain history pages.
  Auto-load once per entry into the top zone; failed requests wait for explicit retry.
  Keep the history control stable during loading, with a delayed progress indicator in reserved space.
- Codex session renaming uses native `thread/name/set`; names belong to Codex and are shared with terminal clients.
- Codex model and reasoning pickers read native `model/list`, including supported/default efforts, and pass optional `model`/`effort`
  to `turn/start`. `turn/steer` cannot change either setting. Current values come from native thread metadata.
- Backend disconnect/restart must never restart a turn, resend an uncertain input, or stop Codex.
- Gate is for trusted internal networks and has no authentication.

## Key files

- `server/src/codex-connection.ts`: SSH, native daemon discovery/start, Unix socket forwarding, JSON-RPC correlation.
- `server/src/agent-backend.ts` / `agents.ts`: backend contract, registration, connection routing and event isolation.
- `server/src/ssh.ts`: shared SSH connection, quoting, shell commands and Git metadata lookup.
- `server/src/ssh-config.ts`: local SSH alias discovery and OpenSSH-resolved connection-field import.
- `server/src/agy.ts` / `acp-connection.ts`: Antigravity native session adapter and persistent ACP transport.
- `server/src/codex.ts`: native session listing, history, subscriptions, messages, decisions, and interruption.
- `server/src/codex-requests.ts`: offered approval choices and structured question answers.
- `server/src/session-files.ts`: bounded SFTP reads, inert text previews with line anchors, images, and downloads.
- `server/src/types.ts`: shared browser/server response types.
- `server/src/db.ts`: server settings, persistent visibility rules/archives, and one-time preservation of old Gate data.
- `server/src/routes.ts` / `index.ts`: HTTP API and browser event delivery.
- `client/src/components/monitor/SessionMonitor.tsx`: the single server/session panel and creation form.
- `client/src/lib/server-groups.ts`: server display groups, owning connection metadata and tool labels.
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
- Validate real tool behavior, including existing native sessions; mocked UI alone does not prove attachment.
- Keep one tool per internal connection while displaying one card per SSH endpoint. Changing provider on an existing
  connection would mix session IDs, drafts and persistent visibility preferences; tool selection edits the correct connection.
- Gate archives are display preferences, not native archives. Filtering/archiving must not mutate native tool sessions.
- Never kill a shared backend to test reconnection. Close only Gate's own connection or an isolated test fixture.
- Preserve passwords on an unchanged edit and never return them in browser API responses or logs.
- Keep `README.md`, `README_CN.md`, and these instructions consistent with shipped behavior.
- Keep `docs/` for current usage and architecture. Do not commit process journals, plans, or validation reports.
- Put optional scratch notes in `.agent-notes/` (ignored); report progress in conversation and commit bodies.
- Keep `LESSONS.md` short and actionable. Update existing lessons instead of appending a diary.
- `AGENTS.md` is a symlink to this file. Preserve the link.
