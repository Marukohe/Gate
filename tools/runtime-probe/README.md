# Remote runtime feasibility probe

Isolated tests of the runtime shipped in `server/runtime/`. Requires Node.js 20+ on a Unix host.
The P0 entry points now import the production implementation; fixtures never use the normal Gate database.

## Run

```bash
node --test tools/runtime-probe/*.test.mjs
node tools/runtime-probe/ssh-smoke.mjs --host localhost
```

For localhost, the SSH probe uses the current Node.js executable's absolute path. For another machine,
pass `--node /absolute/path/to/node` if its non-interactive SSH environment cannot resolve `node`.
SSH must already work non-interactively. Host verification uses the user's existing OpenSSH configuration.

Optional installed-provider checks:

```bash
node tools/runtime-probe/ssh-smoke.mjs --host localhost \
  --codex /absolute/path/to/codex --claude /absolute/path/to/claude \
  --report /tmp/gate-runtime-report.json
GATE_CODEX_BIN=/absolute/path/to/codex node --test tools/runtime-probe/provider-cli.test.mjs
GATE_CODEX_BIN=/absolute/path/to/codex GATE_CLAUDE_BIN=/absolute/path/to/claude \
  node --test tools/runtime-probe/hooks-cli.test.mjs
```

The script uploads only these probe modules to a fresh `/tmp/gate-p0.*` directory, starts a detached runtime,
kills its own watching SSH client, then uses fresh SSH connections to check execution and replay.
Successful runs stop the owned processes and remove the temporary directory. Failed runs preserve evidence
and print the directory; never stop unrelated processes or remove directories based on a broad name match.

Provider checks run `--version` and initialize each CLI's bidirectional protocol over stdio, using isolated
`CODEX_HOME` / `CLAUDE_CONFIG_DIR` directories. No user prompt or model turn is sent. Semantic approvals, terminal
attachment, and hooks are not exercised by this probe.
Review launch restrictions and Codex configuration reads are included. The optional Codex test creates a read-only
thread and verifies an inherited MCP server stays disabled; it intercepts the turn request before sending any prompt.
The hook CLI test verifies actual Claude SessionStart delivery and untrusted Codex hook discovery in isolated configs.

The production workbench check additionally restarts the actual backend, disconnects its SSH transport, checks
parallel worktrees and confirmed completion/stop, persists decisions across restart, rejects conflicting answers,
and runs real verification commands with code snapshots and downloaded logs. Provider decisions are exercised through
deterministic Claude streaming and Codex app-server fixtures. It also verifies handoff context, a fixed review snapshot
across backend restart, concurrent work in the source checkout, and failure when the review checkout changes:

```bash
npm run build
node tools/runtime-probe/workbench-smoke.mjs
```

This check uses localhost SSH and `~/.ssh/id_rsa` by default; set `GATE_TEST_SSH_KEY` for another private key.
Optional browser checks use `GATE_TEST_PLAYWRIGHT` (absolute module path) and `GATE_TEST_CHROMIUM` (executable).
Scoped-hook checks also cover event delivery through localhost SSH, record recovery, task association, shared-checkout
conflicts, manual inspection, new activity after inspection, and preserving removal through the browser.

## Protocol v1

The runtime listens on `<directory>/runtime.sock`. Clients exchange one newline-delimited JSON request and
response per connection. The CLI `request` command accepts a JSON object on stdin and adds `version: 1`.
The direct socket request must include that version explicitly.

| Method | Fields | Result |
| --- | --- | --- |
| `ping` | None | Version, shutdown state, explicit capabilities |
| `start` | `runId`, `command`, `args`, absolute `cwd`, optional `initialInput`, `protocol` | Run snapshot |
| `list` | None | All run snapshots |
| `get` | `runId` | Run snapshot |
| `events` | `runId`, optional `after` and `limit` | Events, next cursor, more flag |
| `input` | `runId`, `inputId`, `data` | Accepted/duplicate status |
| `interrupt` | `runId` | Snapshot; poll until confirmed exit |
| `shutdown` | None | Acknowledgement; socket closes after owned children exit |
| `observe-configure` | `scopeId`, canonical `cwd`, `provider`, `enabled` | Scoped observer settings |
| `observe` | `scopeId`, `provider`, `sessionId`, canonical `cwd`, `event` | Durable latest activity |
| `observe-list` | `scopeId` | Scope and observed session snapshots; no process-control capabilities |

Executable arguments are passed directly with `spawn`, without shell interpolation. Each live child owns a
Unix process group. Interruption sends TERM and escalates to KILL after a timeout. This is process termination,
not a provider's semantic "interrupt this turn and keep the conversation open" operation.

Events have a monotonically increasing per-run `seq`, timestamp, type, and payload. Both output streams use
incremental UTF-8 decoding. Each journal append is synced before acknowledgement or cursor publication.
Replayed `(runId, seq)` pairs allow a consumer to deduplicate; replay alone does not deliver exactly-once effects.

Repeated starts with the same run ID and spec return the existing run, including after a clean restart.
Conflicting specs are rejected. Input IDs deduplicate submissions. Input acceptance is persisted before writing
to stdin; a crash between acceptance and writing has an unknown delivery outcome and is not automatically retried.

## Failure boundaries

- Browser/backend/SSH disconnection: the independent runtime continues owning the process and recording output.
- Clean runtime shutdown: owned processes are terminated and reaped; completed journals remain readable after restart.
- Runtime crash: active journals become `lost` on recovery. No relaunch, reattachment, or stale-PID signalling.
  A leftover socket requires operator inspection; it is never removed automatically.
- Truncated/corrupt journal: fail startup and preserve evidence instead of guessing which command ran.
- Journals have a 64 MiB per-run output limit and indexed, byte-bounded replay; exceeding the limit stops the run.
  Completed journals are retained until explicitly removed while the runtime is stopped. Aggregate disk use is not bounded.
- Machine reboot, disk-full recovery, automatic runtime upgrades, and PTYs remain outside these checks.
  Descendants that leave the owned process group are not contained.

The directory and socket must remain private to the owning OS user. Journals contain command arguments and
input/output; they are local diagnostic data and must not be committed with credentials or private transcripts.
