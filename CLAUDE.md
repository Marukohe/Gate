# Gate

Gate is a simple Server → repository groups → native sessions panel. Keep it simple.
Codex uses its native shared app-server daemon through SSH Unix socket forwarding. Antigravity (agy) uses a persistent
ACP stdio connection over SSH. Add tools through the backend contract and registration, not protocol branches in the UI.
Do not add task/project workflows, a Gate remote runtime, transcript scanners, hook observers, or per-message CLI execution.

## Architecture

- React browser → HTTP actions and WebSocket events → Gate backend adapter → SSH → native tool.
- HTTP routes use `AgentService`; protocol implementations satisfy `AgentBackend`. New SSH accounts are shared by their
  tool connections. Add server only asks for SSH details. Discovery and launch share executable lookup, preferring
  the login PATH with interactive startup as a fallback. Launch native protocols without a terminal using the resolved
  executable and its PATH. Keep accounts with no matches visible and allow absolute path overrides in server settings.
  SSH, SFTP, repository lookup and direct shell execution live outside tool-specific transports.
- Keep each tool's metadata, native adapter, transport and protocol tests under its own directory in
  `server/src/agents/`. Export a typed factory from its `index.ts` and register it explicitly in the common registry.
  Agents use the shared contract and helpers. The service and HTTP entry point deal in Gate types.
- The sidebar groups tool connections by SSH host and port into one server entry, using the oldest connection's name.
  Merge repository groups across tools, label session rows and attention lists with tool tags, and count server groups.
  Keep connection ID plus native session ID on every action, draft, cache and row key; native IDs can collide across tools.
  New-session chooses among connected tools and asks for the working directory. Visibility settings remain scoped
  to their original connections; regrouping must not migrate or combine saved exclusions/archives.
- New connections offer local `~/.ssh/config` hosts first, then manual entry. Discover concrete aliases through Includes;
  use local `ssh -G` to resolve fields. Import an editable snapshot without modifying SSH config or exposing key contents.
  Do not silently import proxy/certificate configurations as direct connections. Config import is independent of the tool.
- Repository groups are derived from read-only Git metadata over the existing SSH connection, with cwd fallback.
  They are display groups, not persisted project workflows. Project headings toggle the whole session list, including
  idle/saved sessions from every tool; never show a partial list as expanded. Groups containing an active or current session
  default to expanded, other groups to collapsed. Search reveals matches without changing the chosen collapsed state.
- A collapsible sidebar owns the monitor, search, status filters, creation and server settings. Desktop collapse preference
  persists in browser storage. Mobile shows one pane at a time and closes the sidebar after selecting a session.
  Desktop sidebar edges resize by pointer or keyboard, with independent persisted widths and double-click reset.
  Fit widths to the viewport while reserving conversation space; viewport changes alone must not overwrite preferences.
  Keep both panes mounted: hiding must preserve list state, chat drafts and scroll. Hidden chat must not capture paste
  or use zero-sized scroll geometry; restore its reading position before paint when visible again.
- Running and Needs you filter the sidebar in place and reveal matching sessions. App owns this transient filter
  so it survives switching conversations. Summary counts remain independent of status/search filters.
- App polls one shared monitor store across navigation. Header Running includes the current thread and marks it Current;
  Needs you lists other waiting/error sessions. Both respect visibility preferences and known connection state;
  transition notices use only known native status, exclude the current thread, and do not open additional conversations.
- Session view state is keyed by server and native thread in browser memory: drafts, model/effort, in-flight actions,
  cached history, and scroll position. Cached approval requests are discarded and native state is refreshed before input.
  Refresh snapshots preserve message items updated while the request was in flight.
- Chats use one compact header. SessionView portals its title/details into AppHeader so live metadata and rename state
  stay with the conversation; sidebar/return/next attention navigation shares the same row; mobile status buttons use icons
  and counts. Directory and theme controls are on demand.
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
  PWA navigation fallback excludes `/api` and `/ws`; file tabs, downloads and API errors must retain server responses.
  Browser smoke tests keep the production service worker active to cover navigation as well as fetch requests.
- A collapsible right file pane browses the owning session's server through the same SFTP path, without agent turns.
  Keep directory listing bounded, text/image previews read-only, and download/open-in-new-tab available.
  Text previews show source line numbers and a browser-persisted wrap toggle; soft wraps must not renumber lines.
  Markdown/HTML support Source / Preview without rereading the file. Markdown shares the chat renderer; relative assets
  resolve beside the viewed file. HTML is parsed in an inert document and rendered only in an opaque sandboxed iframe
  with restrictive CSP; no scripts, forms, nested frames or external stylesheets. Never inject it into Gate's document.
  Browser-memory directory/file selection is keyed by connection and native session; abort stale reads on navigation.
  Compact windows temporarily hide the left sidebar; mobile shows the right sidebar in place of chat, with an explicit return.
  Preserve chat drafts/scroll and keep sidebar paste outside the composer.
- Files and Terminal toggle independently in the same resizable right sidebar. When both are open, files are above
  the terminal. Render the terminal with Ghostty Web only when requested. Its authenticated WebSocket carries byte
  input/output and PTY sizes. Start the shell on the owning SSH account in the native session cwd, via the owning Gate
  for peer sessions. The shell has its own SSH connection and remains mounted while folded. Closing the connection
  ends the shell without interrupting the tool backend.
  Load the bundled terminal font before measuring cells. Apply Gate theme changes to the canvas and its existing
  output while preserving the Ghostty buffer and SSH connection.
- Scrolling upward near the chat top loads one native history page at a time. Prepending anchors the visible message
  before paint; manual loading/retry remains available. Initial bottom positioning must not drain history pages.
  Auto-load once per entry into the top zone; failed requests wait for explicit retry.
  Keep the history control stable during loading, with a delayed progress indicator in reserved space.
- Codex session renaming uses native `thread/name/set`; names belong to Codex and are shared with terminal clients.
- Codex model and reasoning pickers read native `model/list`, including supported/default efforts, and pass optional `model`/`effort`
  to `turn/start`. `turn/steer` cannot change either setting. Current values come from native thread metadata.
- Backend disconnect/restart must never restart a turn, resend an uncertain input, or stop Codex.
- Gate requires an instance token for HTTP APIs and WebSocket upgrades. Browser access uses a persistent HttpOnly
  cookie. Only the login page and its static assets are public. Use HTTPS outside trusted networks.
- Gateways join direct peer snapshots and events through authenticated server-to-server connections. Namespace remote
  connection IDs before they reach client state and include the gateway in the server group key. Forward session
  actions and file requests to their owner. Peer subscriptions and lists include only local data to prevent loops.
  Keep peer failures isolated. Do not expose stored tokens, pass browser cookies to peers, or replay failed writes.

## Key files

- `server/src/agents/backend.ts`, `service.ts`, `registry.ts`: adapter contract, connection routing and built-in registrations.
- `server/src/agents/codex/`: Codex sessions, approval translation and native WebSocket transport over SSH.
- `server/src/agents/antigravity/`: Antigravity sessions and persistent ACP transport.
- `server/src/ssh.ts`: shared SSH connection, quoting, shell commands and Git metadata lookup.
- `server/src/ssh-config.ts`: local SSH alias discovery and OpenSSH-resolved connection-field import.
- `server/src/session-files.ts`: bounded SFTP directory/file reads, inert text previews with line anchors, images, and downloads.
- `server/src/terminal/session.ts` and `client/src/components/terminal/TerminalPane.tsx`: SSH PTY bridge and browser renderer.
- `server/src/types.ts`: shared browser/server response types.
- `server/src/db.ts`: server settings, persistent visibility rules/archives, and one-time preservation of old Gate data.
- `server/src/routes.ts` / `index.ts`: HTTP API and browser event delivery.
- `server/src/auth.ts`: token provisioning, browser sign-in and shared API/event authentication.
- `server/src/gateways.ts`: peer setup, monitor fan-out, event relay and routing to the owning Gate.
- `client/src/components/monitor/SessionMonitor.tsx`: the single server/session panel and creation form.
- `client/src/lib/server-groups.ts`: server display groups, owning connection metadata and tool labels.
- `client/src/components/chat/SessionView.tsx`: conversation history, live events, input, and approvals.
- `client/src/components/files/FileBrowser.tsx`: session-scoped directory browsing and read-only previews in the right sidebar.
- `client/src/components/Markdown.tsx` / `client/src/lib/html-preview.ts`: shared Markdown rendering and isolated static HTML preparation.
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

Gate is published as `@marukohe/gate` in GitHub Packages. An annotated `v<version>` tag matching `package.json` triggers
the GitHub release workflow. Put release notes in the tag message. The workflow builds once, publishes the npm tarball,
and attaches the same file as `gate.tgz` to the release.
`bin/gate.js` serves the built app on port 3030. `gate update` installs the latest stable, versioned release asset with
npm into the running CLI's global install prefix. The update command leaves server startup and restart to the caller.
Data defaults to `~/.gate/gate.db`. Preserve existing user data when removing old mechanisms.

## Working rules

- Read `LESSONS.md` and recent `git log` before changing behavior.
- Commit completed steps with small, meaningful Conventional Commits.
- Run relevant tests, clear compiler warnings, and build broad frontend/server changes before committing.
- Validate real tool behavior, including existing native sessions; mocked UI alone does not prove attachment.
- Keep one tool per internal connection while displaying one entry per SSH endpoint. Changing provider on an existing
  connection would mix session IDs, drafts and persistent visibility preferences; tool selection edits the correct connection.
  When adopting a matching legacy connection into an SSH account, preserve its ID, custom executable and preferences.
  Changes to display names or account linkage do not reconnect the native tool.
- Gate archives are display preferences, not native archives. Filtering/archiving must not mutate native tool sessions.
- Never kill a shared backend to test reconnection. Close only Gate's own connection or an isolated test fixture.
- Preserve passwords on an unchanged edit and never return them in browser API responses or logs.
- Keep `README.md`, `README_CN.md`, and these instructions consistent with shipped behavior.
- Keep `docs/` for current usage and architecture. Do not commit process journals, plans, or validation reports.
- Put optional scratch notes in `.agent-notes/` (ignored); report progress in conversation and commit bodies.
- Keep `LESSONS.md` short and actionable. Update existing lessons instead of appending a diary.
- `AGENTS.md` is a symlink to this file. Preserve the link.
