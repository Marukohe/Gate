# Sessions

New servers store one SSH account. Codex and Antigravity have separate native connections using that account.
Routes use `AgentService` and the `AgentBackend` contract; tool adapters own protocol translation. New tools register a
definition and backend implementation. Session capabilities determine available UI controls.

The sidebar presents one server group per SSH hostname and port, regardless of tool or account. The oldest saved
connection supplies its display name. Repository groups combine sessions across those connections; session titles and
attention lists show tool tags. Server counts use these display groups. Different SSH ports stay separate.
Navigation, draft/cache keys, native actions and archive/restore retain the owning connection ID and native session ID.
Do not deduplicate sessions by native ID alone. A disconnected tool shows an error within its group without hiding healthy tools.
The new-session and filter dialogs select a tool when needed. Filter/archival preferences remain
per connection; combining the display never combines or overwrites stored rules.

## Gateways

The browser signs in to its Gate with an instance token and receives an HttpOnly session cookie. A connected Gate
uses its own token as a Bearer credential. The receiving instance groups servers by gateway plus SSH endpoint
and qualifies connection IDs before returning the monitor or forwarding events. Conversation history, actions,
settings, and files go to the Gate that owns the connection.

Each peer supplies its own local servers and events. Connecting two Gates in both directions still produces one copy
of each local server. A failed peer keeps its last observed sessions visible as unknown while the other sources update.
Writes have a bounded wait and are never automatically retried.

Add server first offers concrete Host aliases from Gate's local `~/.ssh/config`, including Include files, with manual
entry always available. Selecting an alias runs local `ssh -G` to fill editable host, port, user and identity-file fields.
The imported connection summary is collapsed unless a password is needed. Saving verifies SSH and resolves registered
executables using the remote login PATH, then tries interactive shell initialization for missing tools. Native
protocols launch without a terminal and receive the PATH from the lookup. An account can be saved before tools are
installed. Server settings allow absolute executable paths, and saving checks for newly installed tools.
Selecting a host alias only reads local SSH config.

For Codex, Gate uses one connection to the shared app-server daemon. SSH forwards the native Unix socket;
Gate installs no remote files and opens no public Codex port. It starts an absent daemon without restarting an existing one.
The Codex executable is resolved through the SSH login shell or an explicit path in server settings.

Antigravity uses one persistent `agy acp` process over SSH, with no per-message CLI launch. ACP lists and loads native
conversations, streams messages/tool output, exposes native permission choices and supports cancellation. Models and
reasoning effort come from native config options. Login on the SSH server with `agy acp --login` before connecting.
Only work started through this connection has known live state. External terminal conversations are saved history;
ACP does not provide their running status, live takeover, rename, or steering. Disconnecting can interrupt ACP-owned
work, and Gate never replays uncertain prompts. Other terminal processes are not stopped.

ACP history is replayed once on load and paged from connection memory. Polling reuses this history instead of loading
it repeatedly. A new history version after reconnect replaces the browser's cached items, avoiding duplicates when
the agent supplies no stable message IDs. Credentials and conversation history are never added to Gate's database.
agy 1.5.16 accepts image input but omits images from `session/load` replay. Images remain visible in connection memory;
they cannot be restored after reconnecting. Gate does not create a separate persistent attachment/history store.

The collapsible sidebar contains search, status filters, server settings and session creation. Conversations open in the
adjacent pane; list and conversation remain mounted when collapsed. Desktop collapse state is saved in browser storage.
Mobile uses one pane at a time and closes the sidebar after selection. Search, filters and expansion state stay across
conversation switches. Hiding chat preserves reading position and prevents it from intercepting image paste in the list.

The right-hand file pane starts at the selected session's native working directory. Directory listings and file reads use
SFTP over that connection's existing SSH transport for both tools, without prompts or shell commands. Listings are bounded
to 1,000 entries; valid symlinks are followed, while broken links and special files cannot be opened. Text previews are
read-only and escaped; images, new-tab opening and downloads reuse the session-scoped file endpoint. Reads are capped at
10 MB, with text previews up to 1 MB. Each conversation remembers its last directory/file in browser memory; stale reads
are discarded after navigation. Compact windows temporarily hide the session list and phones show the file pane alone;
closing it restores chat with its draft and reading position preserved.
Markdown and HTML files offer Source / Preview using the already-loaded text. Markdown shares the chat renderer, resolving
local links/images relative to the file and keeping heading anchors inside the preview. HTML renders inline styles and images
in an opaque sandboxed iframe with a restrictive CSP. Parsing is inert; scripts, forms, nested frames and external stylesheets
are disabled. Original source remains available through the file endpoint and downloads.
The PWA caches the app shell but excludes `/api` and `/ws` from navigation fallback. Opening file URLs in new tabs
preserves server text/image/download responses and errors instead of substituting the Gate home page.

The panel groups sessions by repository under each server. Read-only Git metadata merges repository subdirectories
and linked worktrees; separate clones remain separate, even with the same name. Non-Git or unavailable directories
use their working path. This metadata is cached briefly and creates no project records.
Projects needing attention precede running projects, followed by recent history. Each project has one clickable heading;
it expands or collapses the entire list, including idle/saved sessions from every tool. Groups containing an active or
current session start expanded; other groups occupy one collapsed row. There is no partially expanded active-only list.
Saved sessions arriving in a later monitor response appear in an expanded group. Polling preserves explicit collapse.
Full directory paths appear on hover; duplicate project names show a short parent path to distinguish them.
Searching names, paths, or previews reveals matching sessions without changing the collapsed state.

Click Running or Needs you to filter this same panel by native session state. Matches expand automatically under
their server and repository, and search further narrows them. The selected filter stays highlighted; click it again
to restore all sessions. Summary counts stay global to the visible snapshot, respecting directory filters and archives.
Status changes update the results automatically. Switching conversations keeps the quick filter; reloading resets it.

A conversation uses a single compact header: sidebar/attention navigation, session title/status dot, and session counts.
Mobile counts use icons to keep the title visible.
Click the title to see server, working directory, full status, rename, theme, and session list actions.
After an attention jump the back arrow returns to the original conversation; the forward arrow opens the next pending one.
Neither conversation details nor return navigation adds a second toolbar above the messages.

The header shows other sessions that need attention (waiting or native session error), and all
running sessions, including the current one, marked Current in the running list. Click a count for names, servers, and
native waiting reasons, then choose a conversation. The same shared
monitor snapshot respects directory filters and Gate archives. This does not subscribe to or resume other threads.
Unavailable servers are excluded from known counts and identified in the list.

While a conversation is open, observed transitions to waiting or native error trigger an eight-second notice.
Initial observations and unchanged snapshots do not alert. Viewing or dismissing the notice leaves the pending session
in the header list until its status changes. The current conversation is excluded from notices and Needs you counts.
After switching through this list or a notice, the back arrow returns to the original conversation, and the forward
arrow (Next needs you) opens another pending session.
Draft text, model/effort selections, loaded history and reading positions are preserved in browser memory across switches.
In-flight actions are not replayed; cached approval IDs are dropped and the thread is refreshed before further input.
These view preferences last until page reload; they are not written to the Gate database or browser storage.

For Codex, the panel reads native threads without starting turns. Opening a conversation subscribes through `thread/resume`
and reads paginated history. New sessions use `thread/start`; messages use `turn/start`, or `turn/steer` while a turn
is active. Stop interrupts the current turn. Closing Gate only disconnects its client; Codex continues running.

Scrolling upward near the top loads the next older history page automatically, with one request in flight at a time.
The visible message stays anchored as older content is inserted, including while output streams below it.
Initial opening still starts at the latest messages. Loading stops at the end of native pagination; the Earlier messages
button remains a manual fallback and lets you retry failed pages without losing already-loaded history.
Upward scrolling pauses bottom-follow, including small movements near the bottom. Scroll back down near the bottom
to resume following output. Programmatic history positioning and periodic refreshes do not re-enable following.

Model and reasoning effort pickers above the message input read the connected server's native catalog. Effort options
follow the selected model; changing models resets the draft effort to that model's default. Both settings take effect
when the next new turn's message is sent and become native session defaults. Current values are read back from the tool.
During a running turn both pickers are disabled, since steering cannot change these settings.
A failed catalog request can be retried without disabling chat.

Codex status comes from its shared backend: running, waiting for input/approval, idle, saved but not loaded, or error.
Connection failures retain the last list with unknown status. Reconnection reloads state and history, never user input.
A saved thread can be resumed on this backend; Gate cannot attach to a separate `--no-daemon` process.

Approvals and supported questions are shared across Gate browser clients. Only provider-offered decisions are accepted,
and answers are sent once. ACP permissions clear after the response is sent; Codex requests clear on native confirmation.
Unsupported Codex requests remain visible for handling in its terminal. Gate does not grant permissions automatically.

SQLite contains connection settings and per-server display preferences. Directory exclusions match the session working
path and its descendants using path boundaries (`/repo` does not match `/repo-old`), not its repository group.
Paths are literal absolute paths, not glob patterns. Worktrees outside an excluded path remain visible.
Gate archives persist the native session ID with its name and directory for restoration; they never invoke native
archive/delete/interrupt APIs. Both settings survive Gate restarts and are shared by all browsers using this Gate.
The filter dialog lists discovered working directories and repository roots, plus saved exclusions and archived-session
directories. Users search the available list and choose Hide, or add a custom absolute parent directory.
Blocked directories have a separate, initially collapsed list with Show controls to remove exclusions.
Paths covered by a parent rule are omitted from the available list.
Saved parent rules cover existing and future descendants without enumerating individual child paths. Hidden or no-longer-discovered paths remain selectable
so they can be unblocked. Checking a parent covers its descendants. The dialog saves these rules and restores archives. Restoring a session does not override directory rules.

Native tools remain the source of conversation history; there is no second Gate message store.
When upgrading an older Gate database, legacy tables and their server references are preserved as inactive archives.

## Adding an adapter

Create `server/src/agents/<tool>/` for the tool's backend, native transport and protocol tests. Its `index.ts` exports
an `AgentAdapter` with a stable tool ID, display metadata, default executable and a factory for the backend.
Implement `AgentBackend` by mapping the tool's native sessions, history, actions and events to Gate types. Report
per-session capabilities so the browser can show the actions the tool supports.

Register the new adapter in `server/src/agents/registry.ts`. Gate uses its metadata for the tool catalog and SSH
executable discovery. `AgentService` routes each connection to its owning backend. Codex and Antigravity are
examples. Both use the same SSH, SFTP, and repository helpers.
