# Managed execution

Managed agent sessions use a detached Node.js runtime on their SSH server. It owns provider processes and journals
ordered events independently of the Gate backend. Saved chat sessions use the separate SSH connection path.

## Configuration

Managed execution settings remain available through existing task links (`#task/<id>`). Supply absolute remote
paths to Node.js, Claude, Codex, and a private runtime data directory outside the checkout. Gate installs its bundled
runtime over SSH. Non-interactive SSH may have a different PATH from an interactive shell.

A task can use a shared checkout or an isolated worktree created from committed HEAD. Uncommitted changes are not
copied. Shared checkouts remain locked until the owning execution has confirmed exit. Project defaults apply to new
tasks; optional setup/run/test scripts come from project overrides or `gate.json` in the checkout.

## Sessions and decisions

The session monitor opens managed output, questions, approvals, stop controls, and terminal attachments directly.
One structured agent run executes one provider turn; a new run starts a fresh provider conversation.

Answers are saved before delivery and synchronized across browsers. Conflicting answers are rejected. A forwarded
answer does not prove the approved tool succeeded. Only choices supported by the provider are offered; unknown
requests stay visible. Run exit or provider cancellation expires stale prompts.

Closing a page or losing SSH/backend connectivity does not stop managed execution. Reconnection replays events.
A stop request stays pending during an outage. Lost runtime ownership is not confirmed exit: checkout locks remain
until the remote process is inspected, and Gate never signals a process solely from a stored PID.

## Native terminals

Terminals require Linux, Python 3.9+ with pidfd support, and a shell. Configure Python and shell paths in runtime
settings. Native Codex additionally requires `--no-daemon` support so execution stays within the owned terminal session.

Use **Attach terminal** to open the PTY. One browser controls input and size; other attachments are read-only.
Detach the controller to transfer control. Native CLI approvals remain inside the terminal.

Reattachment replays output, but keystrokes with a lost acknowledgement are not automatically resent.
**Stop run** waits for cleanup of the owned terminal session, including foreground/background process groups.
Descendants that create another OS session are outside that guarantee.

Output is journaled with a 64 MiB per-run limit; the browser keeps 5,000 scrollback lines. Raw terminal input is
replaced by keyed fingerprints in journals. Visible output, including echoed input, is still recorded. Keep the
private runtime `input.key` with journal backups; missing or changed keys prevent recovery.

## External session hooks

Existing project/task views expose **Manage checkout hooks**. Configure the server runtime first, then install
observers for the selected working copy. Claude uses `.claude/settings.local.json`; Codex uses `.codex/hooks.json`.
Existing settings and unrelated hooks are preserved. Backups stay in the runtime's private `hook-backups/` directory.
Removal deletes Gate's matching entries without restoring an old file over subsequent edits.

Restart the native CLI after installation. For Codex, enable hooks and review new definitions through `/hooks`.
Gate does not grant trust or change user-wide settings. New worktrees do not automatically inherit these observers.
See the provider's [Claude hook documentation](https://code.claude.com/docs/en/hooks) and
[Codex hook documentation](https://learn.chatgpt.com/docs/hooks) for native configuration.

Hooks report identity, checkout, and activity; they do not provide live input, stop, or attachment capabilities.
They cannot discover sessions that were already running before installation or reconstruct missed events.
Silence means unknown status. Unended observations block new managed writers in that checkout until a session-end
report or explicit inspection clears them; renewed activity restores the conflict.

## Code evidence and delivery

Existing task views support verification, handoff, independent review, and delivery:

- Verification records the command, directory, code snapshots, exit status, and output. A temporary Git index captures
  tracked/non-ignored changes without altering real staging. Ignored files and external dependencies are excluded.
- Handoff supplies saved context to a fresh conversation. Independent review uses a fixed snapshot and separate
  checkout; later edits make that review stale. Provider restrictions do not replace an OS sandbox.
- Delivery requires a current preview of the checkout, branch, code, and origin. Commit runs normal Git hooks; push
  sends the inspected commit without force. Draft PR creation requires the same commit on origin and authenticated
  GitHub CLI access. Interrupted operations require inspecting local/remote state before retrying.
- Successful execution, verification, review, or delivery does not automatically accept a task.

## Runtime guarantees and limits

Launch requests are persisted before start and retried with the same identity. Events, state projection, and replay
cursors are committed together. Each run pins its worker and transport client release. Runtime upgrades require
active execution to drain; use one Gate backend per runtime directory.

Machine reboot recovery, runtime-crash reattachment, disk-full recovery, automatic retention, and escaped process
sessions are not guaranteed. External writers are not controlled by checkout locks; hooks are advisory. Observation
snapshots, hook backups, and review worktrees remain until explicitly cleaned up.
