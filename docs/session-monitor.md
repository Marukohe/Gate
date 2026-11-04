# Session monitor

Gate's default page answers three questions: what is running on each server, what needs a response, and what
finished. Servers group sessions on one page. Search finds a server, session, agent, or working directory.
There is no navigation menu and no required project/task setup.

Each server has New session and Edit controls. A new session uses a name, directory, and agent (Codex by default).
Opening a saved conversation explicitly connects it; browsing the panel never launches a CLI. Returning to the
panel clears the automatic conversation reconnect target without stopping an owned process. Managed sessions
open logs, pending decisions, stop controls, or terminal attachment directly. External sessions open observed
activity and identity; their input and lifecycle remain in the native terminal.

## Status evidence

`GET /api/monitor` is a read-only projection refreshed every three seconds. It combines saved chat messages and
owned SSH channels, managed runtime records, checkout hooks, and cached terminal discovery. It returns bounded activity
previews without prompts, review packets, full tool payloads, or server credentials.

- Running: a live owned chat channel without a final result, a recently confirmed active managed run, or a fresh
  native busy event or recent recorded Codex activity. It is not a completion percentage or proof of process liveness.
- Needs you: a current question or managed approval, or a fresh external waiting event.
- Finished/Failed: an explicit saved result/error or confirmed managed outcome. Finished means the turn/run ended;
  it does not accept a task or imply an interactive CLI has exited.
- Idle/Stopped: a ready channel or native idle/end report, or an interrupted managed run.
- Unknown: no live ownership, lost/unconfirmed runtime contact, or stale native observations. Managed health expires
  after 30 seconds without reconciliation; native activity expires after 60 seconds without an event.

The panel keeps the last snapshot during a refresh failure and marks its state unconfirmed until recovery.
Legacy records lacking result subtypes are not guessed complete. Native conversation IDs are not process handles:
a matching externally resumed conversation replaces an inactive saved entry with an observed entry, preventing
an accidental second writer. Existing managed ownership takes precedence over duplicate hook signals.

## Terminal Codex sessions

While the panel is open, Gate checks each server over a separate SSH/SFTP connection approximately every 15 seconds.
It reads the SSH user's `~/.codex/sessions`, or `$CODEX_HOME/sessions` when that variable is available to the SSH shell.
No hooks, project registration, remote runtime, or Codex restart are needed. A custom home set only in a terminal
must also be available to the SSH shell. Gate cannot discover another OS user's private sessions.

Discovery reads bounded headers and tails of the 100 most recently modified rollouts, including resumed files
in older date directories. Unchanged files are cached; child-agent rollouts are excluded. These rows show recorded
activity and open read-only details. They do not attach to, send input to, or stop the native process.
Connection failures appear under the server; cached activity remains visible with unknown status until recovery.
Existing checkout hooks continue to supply events, including approval requests that rollouts may not record.
