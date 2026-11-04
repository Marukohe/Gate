# Task workbench acceptance

This record maps the active [refactor plan](refactor-plan.md) to implementation and validation evidence.
The checks use isolated repositories, databases, runtime directories, and localhost SSH. They do not publish a
package, push this repository, or create a real GitHub PR.

| Requirement | Implementation and evidence |
| --- | --- |
| Fix the reported native dependency failure | Node.js 24.14.0, ABI 137, opens `better-sqlite3` successfully; SQLite reports 3.51.2. Server persistence tests use the native module. |
| Projects, multiple checkouts, independent tasks/runs | `workbench/store.ts`, routes, project/task forms; store/API tests cover restart, defaults, isolation, and cross-project rejection. |
| Preserve existing work | Additive legacy import keeps session/message history and imports only explicit goals. Store tests cover repeat migration and independent edits; Sessions remains accessible. |
| Attention-first overview | Overview groups pending decisions before other task statuses; filters select projects/machines. Attention/store tests and two-browser smoke cover conflicting answers and durable decisions. |
| SSH-connected independent execution | Remote runtime owns children and journals. Localhost smoke closes Gate's SSH transport and restarts the actual backend; output replays once, owned runs continue, and confirmed stop releases locks. |
| Distinct input and recovery capabilities | Runtime tests cover accepted-input identity, duplicate starts, cursor replay, corruption, and lost ownership. Terminal replay never automatically repeats uncertain keystrokes. |
| Evidence tied to code | Snapshot/verification tests and SSH commands check exact trees, real exit 0/7, output downloads, stale evidence, and unchanged real staging. |
| Handoff and independent review | Context packets retain task requirements and prior evidence. SSH/browser checks cover separate review worktrees, fixed comparison snapshots, concurrent task writes, and modified-review rejection. |
| External session awareness | Hook tests preserve unrelated settings, restrict checkout scope, and minimize payloads. Browser/SSH checks cover association, conflicts, inspected dismissal, renewed activity, and removal. |
| Live Codex interaction | Opt-in live localhost SSH checks pass native approvals, file modification, restart while waiting, and native cancellation. Native `/hooks` and the live hook check pass exact-hash trust and SessionStart/UserPromptSubmit/Stop delivery. |
| Persistent native terminals | PTY and browser checks cover keyboard input, UTF-8, resize, Ctrl-C, control transfer, disconnect/reconnect, and confirmed foreground/background exit. Installed Codex is tested with `--no-daemon` to retain lifecycle ownership. |
| Project defaults and scripts | Project settings apply to new tasks only. Script previews resolve overrides and `gate.json`; stale commands are rejected. Actual SSH scripts verify Node PATH and purpose-specific setup/run/test records. |
| Explicit delivery and acceptance | Real Git commits/pushes use inspected snapshots and a temporary bare origin. Tests reject changed code/origin, preserve hooks, and deduplicate restart. PR title/body/base and reuse use a CLI fixture. Done is explicit. |
| Responsive task workflow | Desktop execution/results share two columns. Mobile uses continuous content with one global navigation row and expandable evidence history; closed tasks cannot launch. The browser smoke checks start, decisions, verification, delivery, and acceptance at 320/390/1365px. |
| Incremental commits and lessons | Each completed step has a Conventional Commit. `LESSONS.md` records verified failures and checks; `AGENTS.md` remains a symlink to `CLAUDE.md`, which requires reading/updating lessons. |

## Validation commands

```bash
npm run test --workspace=server -- --run
npm run build
GATE_CODEX_BIN=/path/to/codex GATE_CLAUDE_BIN=/path/to/claude node --test tools/runtime-probe/*.test.mjs
GATE_TEST_PLAYWRIGHT=/path/to/playwright/index.mjs GATE_TEST_CHROMIUM=/path/to/chrome \
  node tools/runtime-probe/workbench-smoke.mjs
GATE_LIVE_PROVIDER_TEST=1 node tools/runtime-probe/live-workbench-smoke.mjs
GATE_LIVE_PROVIDER_TEST=1 GATE_LIVE_CANCEL=1 node tools/runtime-probe/live-workbench-smoke.mjs
GATE_LIVE_PROVIDER_TEST=1 node tools/runtime-probe/live-hooks-smoke.mjs
```

Live scripts require existing login and can consume provider usage. Their disposable private authentication copies
are removed after runtime drain. See the [probe guide](../tools/runtime-probe/README.md) for unexpected approvals.

## Agreed scope and limits

The user selected Codex for live model acceptance while Claude is unavailable. Claude's installed CLI initializes
successfully, and its adapter is covered by protocol fixtures; the attempted model request returned revoked-token
authentication failure. Successful live Claude execution is not claimed.

Native terminal support requires Linux and Python 3.9+ with pidfd support. Native Codex requires `--no-daemon`.
Hooks observe external sessions; they do not attach to or control them. Tools launched outside Gate can still race
checkout inspection. Machine reboot/daemon-crash reattachment, disk-full recovery, escaped process sessions,
automatic retention, team authorization, model account routing, and automatic agent orchestration are outside this plan.
Independent review tests prove context/snapshot isolation, not model review quality. No public npm deployment or
real GitHub publication is part of acceptance.

## Navigation refinement checks

The browser smoke additionally checks all four primary destinations at 320/390/1365px, one navigation landmark,
active-page indication, direct task creation, task search, and light/dark appearance. Project/runtime/hook forms
remain available through dialogs. The historical mobile section shortcuts were removed at the user's request.
The frontend-only `navigation-smoke.mjs` verifies flat cross-machine session discovery without launch, explicit
chat opening, primary navigation inside chat, machine editing, and visible runtime-configuration failures.
