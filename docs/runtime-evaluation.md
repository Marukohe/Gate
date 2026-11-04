# P0 runtime evaluation

## Decision

Proceed with an SSH-connected, independently supervised runtime boundary for managed execution.
The isolated Node.js prototype proves stdio transport and lifecycle feasibility without new native dependencies.
Keep it under `tools/runtime-probe` until production persistence, resource bounds, provider control, and deployment
are implemented. The application still uses its existing SSH exec path; this experiment does not change that path.

Preserve provider-specific structured interaction. Codex app-server is a candidate for long-lived interaction;
the current per-message exec adapter remains the compatibility path until a full adapter is validated.
Treat hooks as identity/event sources, with explicit capabilities for observed external sessions.

## Alternatives

| Option | Evaluation |
| --- | --- |
| Backend-owned SSH exec | Existing implementation; channel ownership cannot establish independent remote recovery |
| Node.js runtime | Implemented and tested for stdio, replay, deduplication, and owned process interruption |
| tmux | Installed locally; a PTY path remains useful, but structured events and durable input handling still need design |
| Herdr / herdr-core | Local Herdr is 0.9.5; `hc` is absent. No integration was installed or existing sessions modified |

Herdr-core documents persistent terminals and a client API. Evaluate it again when implementing PTY attachment;
do not assume the installed Herdr TUI has the same API or capability set as the separate core runtime.

## Verified evidence

Host scope: Linux, Node.js v24.14.0, real OpenSSH connections to localhost, isolated temporary directories.

- Eight process/socket tests cover replay, concurrent runs, duplicate/conflicting requests, exit failures,
  TERM/KILL interruption, child process groups, shutdown draining, and recovered unowned run records.
- The SSH smoke test kills its own watching SSH process and confirms that the fixture continues producing events.
- Fresh SSH clients recover a contiguous journal with the saved cursor; duplicate start and input requests do not
  produce a second execution or second input. Parallel runs do not share input/output.
- Interruption produces a confirmed exit event. Exit code 7 and stderr are preserved for a failing process.
- A clean runtime restart retains completed journals and rejects implicit reruns of the same run identity.
- Installed Claude Code 2.1.126 and Codex 0.166.0 execute `--version` through the runtime.
- The actual Codex app-server accepts `initialize` over the runtime's stdio path, followed by `initialized`.
  Its configuration is isolated; no model turn, account read, user transcript, or existing session is used.

Reproduce with the commands in [the probe README](../tools/runtime-probe/README.md).
The optional JSON report records executed checks and provider versions without private transcript content.

## Unverified and required before production

- Real model turns, tool execution, semantic turn interruption, approval responses, and Claude bidirectional control.
- PTYs, terminal resizing/attachment, external hooks, non-Linux hosts, and WAN failure behavior.
- Real Gate backend restart: fresh probe clients were exercised; production backend integration does not exist yet.
- Runtime crash or machine reboot preserving live processes. Recovery marks unknown ownership as `lost`.
- Journal retention, indexed replay, resource bounds, disk failure handling, and safe automatic runtime upgrades.
- Input exactly-once delivery: acceptance can be durable while actual consumption remains unknown after a crash.

## Problems found

Non-interactive SSH did not include Node.js in PATH; the probe uses an explicit executable path.
Codex 0.166.0 rejects Gate's existing `--full-auto` launch flag. This is a separately tracked compatibility fix.
Shutdown must drain children before removing its control socket, otherwise test cleanup can race active journals.
See [LESSONS.md](../LESSONS.md) for the corresponding prevention checks.

## Sources checked

- [Codex app-server](https://learn.chatgpt.com/docs/app-server): initialization and bidirectional stdio protocol.
- [Herdr-core](https://herdr.dev/core/): persistent terminals and the client API; not locally validated.
- Installed CLI `--version`, `exec --help`, and `app-server --help` output, checked during the probe.
