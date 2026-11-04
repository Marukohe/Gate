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
- Optional browser smoke: start/output/stop, two-browser decision synchronization, verification, explicit task acceptance,
  and controls at 320px, 390px, and 1365px.
- Installed Claude Code 2.1.126 and Codex 0.166.0 both accepted protocol initialization through the runtime using
  isolated configuration directories. No model prompts or account operations were performed.

## Remaining boundaries

The end-to-end lifecycle test uses a deterministic provider fixture. Real model/tool/approval execution still needs
separate validation. PTYs, hooks, handoff, and review snapshots are P4. Machine reboot, runtime-crash reattachment,
disk-full recovery, automatic journal retention, and descendants escaping the owned process group are not guaranteed.
Concurrent writers started outside managed task execution are not covered by checkout locks.
