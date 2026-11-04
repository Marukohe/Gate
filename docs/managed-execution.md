# Managed task execution

Tasks use a detached Node.js runtime on their SSH machine. The runtime owns each provider process and writes
ordered events independently of the Gate backend. Existing Sessions continue using the legacy connection path.

## Setup and use

1. Add a machine and a project checkout, then create a task.
2. Open the task's machine runtime settings. Supply absolute remote paths to Node.js, Claude, Codex, and a private
   runtime data directory. Use `command -v node`, `command -v claude`, and `command -v codex` on that machine.
3. Install the runtime through the task page. Gate copies its bundled modules over SSH and starts a detached daemon.
4. Start the task. Default isolation creates a task branch/worktree from committed HEAD; it does not copy uncommitted
   changes. Shared-checkout runs hold a persistent lock against other managed task runs.
5. Read output or request a stop. A stop request remains pending during an outage; only a remote exit releases the lock.
   Successful execution moves the task to review. Marking the task done remains an explicit user action.

One agent run executes one provider turn. Additional agent runs currently start fresh provider conversations.
Questions, supported approvals, and failures appear at the top of the task and in the Overview attention section.
Answers are saved before delivery and synchronized across browsers. A saved response stays pending until the remote
worker reports forwarding it; it is not proof that the approved tool succeeded. Conflicting answers are rejected.
Unknown requests remain visible with their capability limit. Provider cancellation or run exit expires stale prompts.

## Results and verification

Refresh changes to capture a repository snapshot and inspect the diff, including non-ignored untracked files.
Run a test command from the task's result panel after the active agent has exited. Verification uses the same durable
runtime and checkout lock, and records the exact command, directory, before/after Git HEAD and tree identities,
start/end times, actual command exit code, signal, and output. Logs can be downloaded as complete NDJSON event records.

Snapshots use a temporary index under Git metadata and do not alter staged changes or the current branch. Ignored
files, installed dependencies, and external services are not part of the code snapshot. Runtime data must be outside
the checkout. A changed checkout makes prior evidence stale; a command that changes source code is explicitly flagged.
Passing verification and agent completion never mark a task done. Acceptance is a separate user action.

## Handoff and independent review

After an agent exits, choose a finished run and a target provider in the task's collaboration panel. Handoff starts
a fresh conversation with the saved goal, acceptance criteria, additional instructions, recent agent messages, and
verification evidence. Previous conclusions are labeled unverified. The exact packet and source run remain visible.

Review captures tracked and non-ignored untracked code in a synthetic commit under `refs/gate/review/<runId>` and
creates a detached worktree beside the task checkout. It preserves the source branch and staging area. The comparison
base and full diff are pinned with the snapshot, so retries cannot silently review a newer version. Review starts
with a fresh conversation and does not receive the implementation agent's conclusions. The source checkout lock is
released only after the review checkout and its ownership are saved, allowing subsequent task work to proceed.

Codex reviews use a read-only sandbox with hooks/apps disabled and each inherited MCP server/plugin disabled in the
thread configuration. Claude reviews expose only Read, Glob, and Grep, disable slash commands, supply an empty strict
MCP configuration, and request disabled hooks. These are provider restrictions, not an OS sandbox for Claude or a
replacement for machine administration policy. Review runs cannot grant additional tool access through Gate.
The worker checks HEAD and the code tree again before reporting success; changed review code fails the run.

Refresh changes to compare a review with the latest task snapshot. Review completion does not overwrite a concurrent
writer's task status or accept the task. Review worktrees, synthetic refs, and diff artifacts are retained for inspection;
automatic cleanup is not implemented. Ignored files and external dependencies are outside the snapshot guarantee.

## Managed terminals

Choose **Shell**, **Claude CLI**, or **Codex CLI** and **Open managed terminal** in a task's Execution panel. The terminal
uses the same task worktree/shared-checkout ownership as other runs. Expand **Terminal paths (Linux)** in machine
settings if Python or the interactive shell is not at `/usr/bin/python3` or `/bin/bash`. Python 3.9+ and Linux pidfd APIs
are required; Gate probes these before launch. No remote npm install or native Node.js addon is required.

Use **Attach terminal** to view the real PTY through xterm.js. One browser controls input and window size; additional
attachments are read-only. Detach the controller to make **Control terminal** available in another browser. Heartbeats
release abandoned browser connections. Resizing the controlling page resizes the remote PTY; other viewers follow its
dimensions. Mobile buttons provide Ctrl-C, Escape, Tab, and arrow keys. Native CLI approvals remain in the terminal;
Gate does not infer structured approvals or task completion from screen text.

Closing a page or losing SSH/backend connectivity detaches the view without stopping execution. Reattachment replays
ordered output and resize events. The page keeps its cursor across transport reconnect; opening a new view replays from
the start. Output is subject to the runtime's 64 MiB journal limit and the browser keeps 5,000 scrollback lines.
Input accepted by the runtime is deduplicated, but input whose acknowledgement was lost is never automatically resent.
Inspect the terminal before retrying such input, especially an Enter key or a command.

Terminal input journal entries contain keyed HMAC fingerprints, not raw bytes. The private `input.key` stays in the
runtime directory and is excluded from downloaded logs; retain it with the journals when backing up runtime state.
Missing/changed keys stop journal recovery. Visible terminal output is still recorded, including anything the program
echoes. This keeps non-echoed password input out of the normal event log without pretending all terminal output is secret-free.

**Stop run** terminates the PTY session, including its foreground/background process groups, and waits for confirmed
cleanup. Linux pidfds prevent signalling a reused process ID; the session leader is retained until cleanup finishes.
A worker exit without the terminal cleanup event becomes `lost` and retains checkout ownership. A terminal exiting
successfully does not move the task to review or done. Runtime/machine crashes and descendants that create another OS
session remain outside the cleanup/recovery guarantee. The terminal is a native shell, not a filesystem sandbox.

The PTY worker uses [Python's PTY facilities](https://docs.python.org/3/library/pty.html) and the browser uses
[xterm.js](https://xtermjs.org/docs/api/terminal/classes/terminal/). [Herdr-core](https://herdr.dev/core/) was reconsidered
as a mature terminal runtime. Gate keeps the existing supervisor, journal, and checkout lifecycle here instead of adding
a second daemon/state store; this choice currently limits the PTY implementation to Linux.

## Contracts

- Prompts travel as JSON on SSH stdin, never as interpolated shell commands.
- The exact launch specification is committed before remote start. Retries reuse the same run ID and spawn bytes.
- Event insertion, state projection, and cursor advancement share a database transaction.
- SSH/backend disconnects preserve process ownership. A failed connection is displayed separately from run failure.
- Runtime ownership loss is `lost`, not confirmed exit. Its checkout remains locked; Gate does not signal recovered PIDs.
- Output is journaled with complete provider messages, a 64 MiB per-run output limit, and indexed replay pages.
- Runtime modules are included in the npm package. Versioned release directories keep worker paths stable.
  Each run pins both its worker and transport client to that release. New runs install current worker modules while
  active runs keep their existing adapter. Replacing the supervisor itself still requires draining its active runs;
  installing files does not replace a live daemon.
- Claude uses streaming control requests. Codex uses app-server initialization, thread creation, and turn execution.
  Unknown requests remain pending; the adapter never invents an approval response.

Provider references: [Codex app-server](https://learn.chatgpt.com/docs/app-server) and
[Anthropic's streaming control implementation](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py).

## External sessions

Open **Manage checkout hooks** in a project or task to install/remove Claude or Codex observers for that working copy.
Set up the machine runtime first. Claude entries go into `.claude/settings.local.json`; Codex entries go into
`.codex/hooks.json`. Existing settings and unrelated hooks are preserved. Changed files are backed up privately under
the runtime's `hook-backups/` directory. Removal deletes only Gate's matching entries and does not restore an old file
over subsequent user changes. Symlinked configuration files/directories are refused to preserve checkout scope.

Restart the native CLI after installation. For Codex, start with `codex --enable hooks`, trust the project if appropriate,
and review the new definitions in `/hooks`. Gate does not modify user-wide configuration or grant hook trust.
Hook files may appear in Git changes; inspect them before including machine-specific paths in a commit.
New task worktrees do not automatically inherit an observer installed in another working copy.

The hook sends only provider/session identity, checkout, and event name to the runtime's private socket. It does not
store prompt text, tool arguments, transcripts, credentials, or process IDs. Gate-managed workers suppress these external
observations. Hooks emit no model context, never decide permissions, and return quietly if Gate is unavailable.
They do not discover a session that was already running before installation. Missed events are not reconstructed.

Overview and task/project pages show the latest reported activity and optional task association. These records provide
observation only: no history, conversation resume, live input, approvals, stop, or terminal attachment is advertised.
Silence means unknown process status, not completion. SessionEnd is a provider report, not an OS exit observation.
Unended sessions block new Gate runs in the same checkout; a separate task worktree remains available. After inspecting
that a native process has exited, use **I confirmed this session exited** to clear a stale record. A new event restores
the conflict. Removing hooks does not assert that a previously observed process exited.

Hook snapshots survive backend/runtime restart. The backend refreshes them separately from managed-run polling and
rechecks before launch. Hook reporting is advisory and cannot prevent external tools from writing or starting later.
An older runtime is upgraded during installation only after its runs have confirmed exit; active/lost ownership blocks
the upgrade. Gate serializes its start requests with this operation. Use one Gate backend for each runtime directory.

References: [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex hooks](https://learn.chatgpt.com/docs/hooks),
and [Herdr integrations](https://acrogenesis.com/herdr/docs/integrations/).

## Verified

- Runtime tests: replay, input/start deduplication, Unicode, signal escalation, child process groups, shutdown drain,
  journal recovery, complete protocol framing, output limits, and malformed requests.
- Provider adapter tests: initialization, tool approval shapes, response deduplication, unknown capabilities, and
  provider failures that must not be mistaken for successful execution; Claude and Codex question response schemas.
- Backend tests: lost start acknowledgement, service restart, durable offline stop requests, retained locks,
  semantic errors with exit zero, unresolved ownership loss, concurrent decision conflicts, lost response acknowledgements,
  P2 attention backfill without cursor rewind, and client release pinning across backend upgrades.
- `node tools/runtime-probe/workbench-smoke.mjs`: real localhost SSH with isolated Git repositories and database;
  actual backend process restart, closed/reopened SSH transport, parallel worktrees, partial Git preparation recovery,
  literal prompt transport, deduplicated starts/events, confirmed completion and stop, decisions across restart,
  actual test commands with exit 0 and 7, source-change detection, and complete event-log downloads.
  Collaboration checks cover cross-provider handoff context, backend restart during review, a concurrent source
  verification, stale review detection, and rejection of a modified review checkout.
- Optional browser smoke: start/output/stop, two-browser decision synchronization, verification, explicit task acceptance,
  and controls at 320px, 390px, and 1365px.
- Installed Claude Code 2.1.126 and Codex 0.166.0 both accepted protocol initialization through the runtime using
  isolated configuration directories. No model prompts or account operations were performed.
- `GATE_CODEX_BIN=/path/to/codex node --test tools/runtime-probe/provider-cli.test.mjs` creates a real read-only
  Codex thread with an inherited MCP fixture and confirms it stays disabled without starting a model turn.
- `hooks.test.mjs` covers scoped installation/removal, unrelated settings, malformed/symlinked configuration,
  private payload minimization, managed/subagent suppression, and runtime restart.
- `GATE_CLAUDE_BIN=/path/to/claude GATE_CODEX_BIN=/path/to/codex node --test tools/runtime-probe/hooks-cli.test.mjs`
  verifies actual Claude SessionStart delivery and Codex discovery without automatically trusting hooks or sending a model turn.
- `terminal.test.mjs` uses an actual PTY and shell to verify UTF-8, window size, Ctrl-C, session cleanup, redacted input,
  retry deduplication after runtime restart, and rejection of missing input keys.
- The workbench SSH/browser check also validates backend restart during a terminal command, native output replay,
  non-echoed input absent from logs, concurrent attachment roles, keyboard input, control transfer, detach, and exit.

## Project settings and scripts

Project settings apply the default agent, checkout, and worktree/shared choice only to new tasks. The review base
branch is separate from the selected checkout's HEAD, which remains the starting point for new task worktrees.
Scripts are read from `gate.json` in the task checkout; nonempty project overrides take precedence. Refresh scripts,
inspect the displayed command and source, then start it explicitly. A changed command rejects an old preview.
The runtime captures the command once; retrying its request ID after a lost response returns the existing run.
All scripts use the same checkout ownership and durable logs as other runs. Setup/run records carry their purpose
and do not mark a task ready for review. Tests can mark it ready for review, but acceptance remains manual.
Long-running scripts keep the checkout occupied until stopped and confirmed exited. If a task has not yet started,
its first script creates its isolated worktree from committed HEAD; uncommitted source changes are not copied.

## Delivery

Refresh the task's delivery preview after inspecting changes. The preview identifies its checkout, branch, HEAD,
code tree, and origin. Commit includes all tracked/non-ignored untracked changes, verifies the staged tree against
the preview, and runs normal Git hooks. If a hook changes the committed tree, the run fails with the actual commit
still recorded; no commit or staging rollback is attempted. Commit failures can leave staged changes.

Push requires a clean checkout and an unchanged origin fingerprint. It pushes the inspected commit SHA to that
branch in origin with no force, tag following, or submodule pushes. Create draft PR requires that exact commit
already on origin, a github.com repository, and an authenticated `gh` on the remote machine. An optional absolute
GitHub CLI path is available in runtime settings. The user supplies title, body, and base; an existing matching
open PR is reused. Gate never implicitly pushes from the PR action. See the upstream
[Git push options](https://git-scm.com/docs/git-push) and [GitHub PR command](https://cli.github.com/manual/gh_pr_create).

Each delivery owns the previewed checkout and records its request before launching. It does not switch to a new
worktree or change task acceptance. Backend/SSH reconnect replays the original run instead of repeating a Git
mutation. If ownership is lost or an operation is interrupted, inspect repository/remote state before starting a
new operation: a command may have taken effect before its result was recorded. Hooks report external activity
but cannot lock out tools launched outside Gate. Preview checks do not provide atomicity against such writers.

Validation uses actual commits and pushes to a temporary local bare repository through localhost SSH and browser
controls, including stale preview rejection and backend restart. PR argument transport/reuse is covered with a
deterministic GitHub CLI fixture; no real GitHub PR is published by the acceptance tests.

## Remaining boundaries

The main end-to-end lifecycle test uses a deterministic provider fixture. Opt-in live acceptance separately verifies
Codex model output, a real file modification, command approvals, service restart while waiting, and native turn cancellation.
The native `/hooks` UI and `live-hooks-smoke.mjs` verify persisted trust followed by real SessionStart/UserPromptSubmit/Stop
callbacks. The test only trusts definitions it generated and inspected, in a disposable configuration directory;
the product still requires users to review their own hooks. See [native hook trust](https://learn.chatgpt.com/docs/hooks).
Per the user's instruction, live model acceptance uses Codex while Claude is unavailable. Claude initialization,
protocol fixtures, and an actual authentication-failure path are verified; successful live Claude model execution is not claimed.

Machine reboot, runtime-crash reattachment,
disk-full recovery, automatic journal retention, and descendants escaping the owned process group are not guaranteed.
Concurrent writers started outside managed task execution are not covered by checkout locks; hooks surface only reported activity.
Observation snapshots and hook backups are retained without automatic cleanup.
