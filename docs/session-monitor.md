# Sessions

Gate uses one connection per server to Codex's shared app-server daemon. SSH forwards the native Unix socket;
Gate installs no remote files and opens no public Codex port. It starts an absent daemon without restarting an existing one.
The Codex executable is resolved through the SSH login shell or an explicit path in server settings.

The panel groups sessions by repository under each server. Read-only Git metadata merges repository subdirectories
and linked worktrees; separate clones remain separate, even with the same name. Non-Git or unavailable directories
use their working path. This metadata is cached briefly and creates no project records.
Projects needing attention precede running projects, followed by recent history. Idle and saved sessions are collapsed;
searching names, paths, or previews reveals matching sessions without changing the collapsed state.

The panel reads native threads without starting turns. Opening a conversation subscribes through `thread/resume`
and reads paginated history. New sessions use `thread/start`; messages use `turn/start`, or `turn/steer` while a turn
is active. Stop interrupts the current turn. Closing Gate only disconnects its client; Codex continues running.

Status comes from Codex: running, waiting for input/approval, idle, saved but not loaded, or error.
Connection failures retain the last list with unknown status. Reconnection reloads state and history, never user input.
A saved thread can be resumed on this backend; Gate cannot attach to a separate `--no-daemon` process.

Approvals and questions are shared across Gate browser clients. Only provider-offered decisions are accepted,
answers are sent once, and requests disappear when Codex confirms resolution or the turn completes.
Unsupported request types remain visible for handling in the native terminal. Gate does not grant permissions automatically.

SQLite contains connection settings. Codex remains the source of conversation history; there is no second Gate message store.
When upgrading an older Gate database, legacy tables and their server references are preserved as inactive archives.
