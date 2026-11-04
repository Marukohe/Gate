# Gate task workbench refactor

Current product direction: the default UI is a [server/session monitoring panel](session-monitor.md).
The user superseded the task-first interface and four-destination navigation below. Those sections remain as
implementation history; existing data and deep links remain compatible.


Status: implementation and agreed workflow acceptance complete. See the [acceptance record](workbench-acceptance.md)
for requirement coverage, repeatable checks, and remaining platform/provider limits.

## Product goal

Manage multiple repositories, tasks, and coding agents from one place. The primary workflow is:
start work, let agents run, resolve blockers, inspect evidence, and deliver a change.

An overview should make the tasks that need a decision visible without opening every conversation.
Keep the current personal, internal-network deployment model. Team permissions, model account routing,
and automatic agent orchestration are outside the initial scope.

## Domain model

| Object | Responsibility |
| --- | --- |
| Project | Repository identity, defaults, and scripts |
| Checkout | A project's working copy on a specific machine, including branch/worktree |
| Task | Goal, acceptance criteria, checkout, delivery status, and PR |
| Run | One agent execution, provider session identity, lifecycle, and events |
| Attention item | A question, approval, or failure requiring a recorded response |
| Artifact | Changes, test evidence, review results, previews, and commits |

Projects can have multiple checkouts and tasks. Tasks can have implementation, retry, and review runs.
Run completion does not automatically complete a task. Review and test evidence must identify the code version.

## User surfaces

- Overview: needs attention, ready for review, running, and queued/paused tasks; project and machine filters.
- Projects: repositories, checkouts, task lists, defaults, and scripts.
- Task: goal, execution history, pending decisions, changes, verification, and delivery actions.
- Desktop: execution and results together. Mobile: decisions and concise results first.
- Keep branch, worktree, and provider defaults available with advanced choices on demand.

## Runtime direction

```text
Browser <--HTTP/WebSocket--> Gate backend <--SSH--> Remote runtime
                                               |-- Provider adapter <--> Managed agent
                                               |-- PTY <--> Interactive terminal
                                               |-- Local socket <-- Hooks/plugins
                                               `-- Durable run events
```

SSH remains the transport. The remote runtime owns execution independently of a backend connection.
Provider adapters supply structured interaction; hooks supply only the identity/events supported by each tool.
External sessions start as observed sessions. History, resume, live input, interrupt, and terminal attachment
must be separate capabilities. Preserve existing provider parsers where applicable.

Evaluate a small Node.js runtime and mature runtime integrations before freezing the implementation choice.
Herdr-core is a candidate, not a required dependency. PTY support and semantic approval support need explicit
validation; neither follows automatically from process supervision or hooks.

## Milestones

### P0: Runtime feasibility

- [x] Add the refactor tracker and lessons workflow.
- [x] Define the minimal runtime protocol and capability boundaries.
- [x] Build an isolated prototype with durable events and idempotent start requests.
- [x] Validate execution across SSH disconnects and client restarts using localhost SSH first.
- [x] Validate input, output, exit status, interruption, and duplicate-request behavior.
- [x] Audit the installed providers and document live-agent validation limits.
- [x] Record the runtime decision and evidence before production integration.

Acceptance: repeatable commands prove which lifecycle guarantees hold; no existing sessions or database
are modified by the prototype. A deterministic fixture tests transport independently of model access.

Evidence and limits: [P0 runtime evaluation](runtime-evaluation.md).

### P1: Task model and navigation

- [x] Add Project, Checkout, Task, and Run persistence with additive, tested migrations.
- [x] Preserve old workspace/session history; avoid guessing ambiguous task relationships.
- [x] Add task creation, project/task lists, and independent goals and delivery status.
- [x] Verify two tasks in the same repository do not overwrite each other's state.

Persistence evidence: `server/src/__tests__/workbench-store.test.ts` covers repeated upgrades, untouched history,
ambiguous primary sessions, independent task state, cross-project constraints, durable checkout ownership,
request deduplication, and transactional event projection. Workbench API tests cover project/checkout creation,
independent task updates, invalid requests, and connection reuse. Browser validation covers creating/editing tasks,
status changes, project navigation, deep-link reload, and narrow-screen layout. Managed execution is P2.

### P2: Persistent managed execution

- [x] Integrate the validated runtime with SSH and provider adapters.
- [x] Replay events after reconnect, deduplicate requests/events, and reconcile run state.
- [x] Confirm stop results and distinguish connection loss from process failure.
- [x] Test backend restart and SSH failure against real remote execution.

Evidence and current limits: [managed execution](managed-execution.md). Lifecycle checks use real localhost SSH
and the actual Gate backend with a deterministic provider fixture; real CLI initialization is verified separately.
Model turns and semantic decision controls are not claimed by these checks.

### P3: Attention and verification

- [x] Persist questions, supported approvals, and failures as attention items.
- [x] Add the attention-first overview and task result view.
- [x] Record test commands, directory, code version, timestamps, exit status, and logs.
- [x] Synchronize decisions across clients and keep task acceptance explicit.

Evidence: attention/store/execution tests cover conflicting answers, restart, stale requests, multiple pending
questions, P2 event backfill, and response acknowledgement loss. The localhost SSH check runs real test commands,
compares code trees, downloads logs, and uses two browser pages to answer a provider fixture and accept a task explicitly.
Actual model-generated requests are covered separately in final Codex acceptance below.

### P4: Collaboration and external sessions

- [x] Discover external sessions through scoped hooks/plugins without claiming unsupported control.
- [x] Add a managed terminal launch entry point and explicit attachment capabilities.
- [x] Add agent handoff and independent review tied to a fixed code snapshot.
- [x] Isolate concurrent writers with worktrees and surface shared-checkout conflicts.

Collaboration evidence: localhost SSH/backend/browser checks cover handoff across providers, persisted context,
review restart, concurrent verification in the task checkout, stale review detection, and modified-review rejection.
Review pins a synthetic commit and comparison base; its separate checkout is verified again at completion.
Actual Codex configuration checks confirm inherited MCP entries are disabled for review. These checks do not claim
model-generated findings. See [managed execution](managed-execution.md) for retained artifacts and provider limits.

External-session evidence: scoped Claude/Codex hook installation preserves existing configuration and records identity
and activity over the private runtime socket. Localhost SSH/browser checks cover restart, task association, same-checkout
conflict rejection, manual inspection, renewed activity, and hook removal. Real Claude initialization emits SessionStart;
real Codex lists the installed hooks as untrusted. Final acceptance below verifies execution after native trust.
Hooks are advisory: unmanaged tools can still start or write without reporting to Gate.

### Final workflow acceptance

- [x] Verify project defaults/scripts and task delivery actions against the user surfaces above.
- [x] Verify managed terminal input, resize, attachment, reconnect, and confirmed exit.
- [x] Validate real provider model/tool/decision flows and trusted Codex hook execution in isolated checkouts.
- [x] Audit the complete start → blockers → evidence → delivery workflow on desktop and mobile.

Final browser acceptance covers the full workflow at 320/390/1365px, desktop execution/results columns, the then-current mobile
section navigation (superseded by the navigation refinement below), recorded decisions including native cancellation, and explicit acceptance with launch disabled
for closed tasks. Recent verification/delivery records stay visible while older records remain expandable.
The final build passes; server tests pass 179 with one optional test skipped, and runtime tests pass all 30,
including installed-provider initialization and the installed Codex PTY lifecycle check.

Terminal evidence: Linux PTY tests cover UTF-8, resize, Ctrl-C, foreground/background cleanup, keyed input deduplication,
and journal recovery. The actual localhost SSH/backend/browser check covers a shell surviving backend restart,
cursor replay, read-only second attachment, browser keyboard input, control transfer, mobile resizing, and confirmed exit.
Native model acceptance is described separately below. Terminal support currently requires Linux and Python 3.9+
with pidfd APIs; descendants that create a different OS session are outside the cleanup guarantee.

Project/delivery evidence: restart tests preserve project defaults without changing existing tasks. Localhost SSH
and browser tests resolve script overrides, execute bare Node.js with the configured PATH, reject stale commands,
and keep setup/run purpose distinct from test evidence. Real Git checks reject stale checkout/remote previews,
preserve normal commit hooks, retain actual artifacts if hooks change the tree, commit inspected changes, and push
the pinned commit to a temporary bare origin. Backend restart returns the existing delivery instead of repeating it.
GitHub PR argument transport, push-destination checks, and reuse use a deterministic CLI fixture; no real PR is published.

Live-provider acceptance uses Codex per the user's instruction to proceed with Codex while Claude is unavailable.
Actual localhost SSH runs verify native command approvals, a file modification, persisted decisions across execution
service restart, and canceled-turn outcome without task acceptance. The local sandbox required explicit escalation
for the tested command; Gate preserved the approval boundary. Native `/hooks` trust and a real Codex turn verify
SessionStart/UserPromptSubmit/Stop delivery; the opt-in hook test repeats this using only inspected fixture definitions.
Claude protocol fixtures and real initialization remain covered; its model request failed with revoked authentication,
so successful live Claude execution is not claimed.

## Validation and delivery

Each completed step gets a Conventional Commit describing behavior, verification, and remaining limits.
Run relevant tests and type checks; run `npm run build` for broad client/server changes.
Use temporary runtime directories and repositories for lifecycle checks. Never stop a process from a stale PID.
Distinguish browser closure, backend restart, SSH failure, runtime crash, and machine reboot in results.

Keep README.md, README_CN.md, and AGENTS.md/CLAUDE.md aligned with shipped behavior.
Update LESSONS.md when a verified issue yields a useful prevention rule.

## Navigation refinement

The user requested a simpler interface with only one navigation level. Tasks, Projects, Sessions, and Machines
now share one persistent navigation row, including inside saved conversations. Tasks can be created directly
from the task list. Session discovery is flat and searchable; opening a conversation remains an explicit action.
Task section navigation and the legacy sidebar are removed. Project/runtime/hook configuration uses dialogs.
Desktop keeps execution and results together; mobile uses continuous content without a second navigation row.
