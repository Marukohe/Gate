# Sessions

Gate uses one connection per server to Codex's shared app-server daemon. SSH forwards the native Unix socket;
Gate installs no remote files and opens no public Codex port. It starts an absent daemon without restarting an existing one.
The Codex executable is resolved through the SSH login shell or an explicit path in server settings.

The panel groups sessions by repository under each server. Read-only Git metadata merges repository subdirectories
and linked worktrees; separate clones remain separate, even with the same name. Non-Git or unavailable directories
use their working path. This metadata is cached briefly and creates no project records.
Projects needing attention precede running projects, followed by recent history. Each project has one clickable heading;
it reveals idle and saved sessions, then collapses all sessions. Running-only groups can also be collapsed.
Active sessions show by default; inactive projects occupy one row. Polling preserves the chosen collapsed state.
Full directory paths appear on hover; duplicate project names show a short parent path to distinguish them.
Searching names, paths, or previews reveals matching sessions without changing the collapsed state.

Click Running or Needs you to filter this same panel by native session state. Matches expand automatically under
their server and repository, and search further narrows them. The selected card stays highlighted; click it again
to restore all sessions. Summary counts stay global to the visible snapshot, respecting directory filters and archives.
Status changes update the results automatically. Returning from a conversation keeps the quick filter; reloading resets it.

Inside a conversation the header shows other sessions that need attention (waiting or native session error), and those
running. Click a count for names, servers, and native waiting reasons, then choose a conversation. The same shared
monitor snapshot respects directory filters and Gate archives. This does not subscribe to or resume other threads.
Unavailable servers are excluded from known counts and identified in the list.

While a conversation is open, observed transitions to waiting or native error trigger an eight-second notice.
Initial observations and unchanged snapshots do not alert. Viewing or dismissing the notice leaves the pending session
in the header list until its status changes. The current conversation is excluded from notices and counts.
After switching through this list or a notice, Return to … takes you back; Next needs you opens another pending session.
Draft text, model/effort selections, loaded history and reading positions are preserved in browser memory across switches.
In-flight actions are not replayed; cached approval IDs are dropped and the thread is refreshed before further input.
These view preferences last until page reload; they are not written to the Gate database or browser storage.

The panel reads native threads without starting turns. Opening a conversation subscribes through `thread/resume`
and reads paginated history. New sessions use `thread/start`; messages use `turn/start`, or `turn/steer` while a turn
is active. Stop interrupts the current turn. Closing Gate only disconnects its client; Codex continues running.

Model and reasoning effort pickers above the message input read the connected server's native catalog. Effort options
follow the selected model; changing models resets the draft effort to that model's default. Both settings take effect
when the next new turn's message is sent and become native session defaults. Current values are read back from Codex.
During a running turn both pickers are disabled, since steering cannot change these settings.
A failed catalog request can be retried without disabling chat.

Status comes from Codex: running, waiting for input/approval, idle, saved but not loaded, or error.
Connection failures retain the last list with unknown status. Reconnection reloads state and history, never user input.
A saved thread can be resumed on this backend; Gate cannot attach to a separate `--no-daemon` process.

Approvals and questions are shared across Gate browser clients. Only provider-offered decisions are accepted,
answers are sent once, and requests disappear when Codex confirms resolution or the turn completes.
Unsupported request types remain visible for handling in the native terminal. Gate does not grant permissions automatically.

SQLite contains connection settings and per-server display preferences. Directory exclusions match the session working
path and its descendants using path boundaries (`/repo` does not match `/repo-old`), not its repository group.
Paths are literal absolute paths, not glob patterns. Worktrees outside an excluded path remain visible.
Gate archives persist the native session ID with its name and directory for restoration; they never invoke Codex
archive/delete/interrupt APIs. Both settings survive Gate restarts and are shared by all browsers using this Gate.
The filter dialog lists discovered working directories and repository roots, plus saved exclusions and archived-session
directories. Users search the available list and choose Hide, or add a custom absolute parent directory.
Blocked directories have a separate, initially collapsed list with Show controls to remove exclusions.
Paths covered by a parent rule are omitted from the available list.
Saved parent rules cover existing and future descendants without enumerating individual child paths. Hidden or no-longer-discovered paths remain selectable
so they can be unblocked. Checking a parent covers its descendants. The dialog saves these rules and restores archives. Restoring a session does not override directory rules.

Codex remains the source of conversation history; there is no second Gate message store.
When upgrading an older Gate database, legacy tables and their server references are preserved as inactive archives.
