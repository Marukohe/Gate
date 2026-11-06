# Sessions

Gate uses one connection per server to Codex's shared app-server daemon. SSH forwards the native Unix socket;
Gate installs no remote files and opens no public Codex port. It starts an absent daemon without restarting an existing one.
The Codex executable is resolved through the SSH login shell or an explicit path in server settings.

The panel groups sessions by repository under each server. Read-only Git metadata merges repository subdirectories
and linked worktrees; separate clones remain separate, even with the same name. Non-Git or unavailable directories
use their working path. This metadata is cached briefly and creates no project records.
Projects needing attention precede running projects, followed by recent history. Each project has one clickable heading;
it reveals idle and saved sessions while active sessions remain visible when collapsed. Inactive projects occupy one row.
Full directory paths appear on hover; duplicate project names show a short parent path to distinguish them.
Searching names, paths, or previews reveals matching sessions without changing the collapsed state.

The panel reads native threads without starting turns. Opening a conversation subscribes through `thread/resume`
and reads paginated history. New sessions use `thread/start`; messages use `turn/start`, or `turn/steer` while a turn
is active. Stop interrupts the current turn. Closing Gate only disconnects its client; Codex continues running.

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
