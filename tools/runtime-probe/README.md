# Remote runtime feasibility probe

P0 experiment, isolated from the Gate server and its database. Requires Node.js 20+ on a Unix host.
Do not use this as a production daemon: journals are unbounded and event paging currently reads whole files.

## Run

```bash
node --test tools/runtime-probe/runtime.test.mjs
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
```

The script uploads only these probe modules to a fresh `/tmp/gate-p0.*` directory, starts a detached runtime,
kills its own watching SSH client, then uses fresh SSH connections to check execution and replay.
Successful runs stop the owned processes and remove the temporary directory. Failed runs preserve evidence
and print the directory; never stop unrelated processes or remove directories based on a broad name match.

Provider checks run `--version`. The optional Codex check also initializes an actual app-server over stdio
using an isolated `CODEX_HOME`, without starting a model turn or loading the user's conversations/configuration.
Claude model output, semantic approvals, terminal attachment, and hooks are not exercised by this probe.

## Protocol v1

The runtime listens on `<directory>/runtime.sock`. Clients exchange one newline-delimited JSON request and
response per connection. The CLI `request` command accepts a JSON object on stdin and adds `version: 1`.
The direct socket request must include that version explicitly.

| Method | Fields | Result |
| --- | --- | --- |
| `ping` | None | Version, shutdown state, explicit capabilities |
| `start` | `runId`, `command`, `args`, absolute `cwd` | Run snapshot |
| `list` | None | All run snapshots |
| `get` | `runId` | Run snapshot |
| `events` | `runId`, optional `after` and `limit` | Events, next cursor, more flag |
| `input` | `runId`, `inputId`, `data` | Accepted/duplicate status |
| `interrupt` | `runId` | Snapshot; poll until confirmed exit |
| `shutdown` | None | Acknowledgement; socket closes after owned children exit |

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
  A leftover socket requires operator inspection; the prototype will not remove it automatically.
- Truncated/corrupt journal: fail startup and preserve evidence instead of guessing which command ran.
- Machine reboot, disk-full recovery, quota enforcement, automatic installation/upgrades, PTYs, and semantic
  approvals are outside this prototype. Descendants that leave the owned process group are not contained.

The directory and socket must remain private to the owning OS user. Journals contain command arguments and
input/output; they are local diagnostic data and must not be committed with credentials or private transcripts.
