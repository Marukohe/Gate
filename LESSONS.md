# Lessons

Record verified problems and reusable prevention checks here. Read relevant entries before starting work.
Keep this file concise; implementation progress belongs in [the refactor plan](docs/refactor-plan.md).

## Native dependencies follow the Node.js ABI

- Observed: the backend failed with `ERR_DLOPEN_FAILED` after switching to Node.js 24.
- Cause: `better-sqlite3.node` was built for ABI 115; the active Node.js required ABI 137.
- Fix: run `npm rebuild better-sqlite3` using the intended Node.js installation.
- Check: open an in-memory database, then run `npm run test --workspace=server -- --run`.
- Prevention: check `node --version` and `process.versions.modules` before diagnosing database code.

## Check port ownership before changing development services

- Observed: Vite selected port 5175 because other projects were using 5173 and 5174.
- Cause: normal Vite port fallback, independent of the backend's native-module failure.
- Check: use `ss -ltnp` and inspect the owning process and working directory.
- Prevention: use the reported frontend URL and verify its API proxy; preserve unrelated development services.

## Session history is not a live process handle

- Observed: the existing providers can resume conversation IDs and read transcript files.
- Cause: those identities describe conversations, while `SSHManager.startCLI` owns a separate SSH exec channel.
- Prevention: distinguish history access, conversation resume, process attachment, and input capabilities.
  Do not launch a second writer merely because a transcript was discovered.
- Reference: `server/src/providers/types.ts` and `server/src/ssh-manager.ts`.

## Non-interactive SSH has a different PATH

- Observed: localhost SSH could run `tmux` but returned `node: command not found`, although local Node.js worked.
- Cause: the non-interactive SSH environment did not include the version manager's Node.js directory.
- Prevention: probe the exact SSH execution environment; use an explicit executable path for runtime bootstrap.
  Do not depend on an interactive shell startup file or install another Node.js merely to work around PATH.
- Check: `tools/runtime-probe/ssh-smoke.mjs` accepts `--node` and uses `process.execPath` for localhost.

## A disappearing socket must not imply premature cleanup

- Found during runtime review: closing the listener before stopping children made a shutdown probe report success
  while processes could still be writing journals.
- Fix: keep the ping endpoint reachable with `closing: true` until owned children have exited; then close the socket.
- Check: the runtime test `shutdown keeps its socket alive until owned children exit` uses a TERM-resistant process.
- Prevention: distinguish shutdown acknowledgement from confirmed cleanup before deleting runtime state.

## Check installed CLI flags before reusing launch commands

- Observed: Codex 0.166.0 rejects the existing `codex exec --full-auto` invocation before starting a session.
- Check: `codex exec --full-auto --help` reports `unexpected argument`; inspect `codex exec --help` on the target.
- Prevention: validate actual argument parsing in addition to command-string unit tests. Preserve sandbox intent
  when replacing removed options; do not substitute an unrestricted bypass flag.
- Affected paths: `server/src/providers/codex/index.ts` and commit-message generation in `server/src/ssh-manager.ts`.
- Fix: share explicit `--ask-for-approval on-request exec --sandbox workspace-write` arguments across launch,
  resume, and commit-message generation. Run the optional real-CLI test with `GATE_CODEX_BIN` set to its executable.

## Browsing saved sessions must not launch them

- Observed: the legacy WebSocket opened or reconnected the session stored in localStorage on every connection.
- Cause: persisted navigation state was treated as execution intent, including when opening the new workbench.
- Fix: reconnect only the target explicitly opened during this page lifetime; the workbench does not auto-connect.
- Check: seed a previous selection in localStorage, open Overview, force a WebSocket reconnect, and verify no
  `connect` command is sent. Explicitly opening a legacy session still requests a connection.

## Check element bounds as well as document overflow on mobile

- Observed: a narrow workbench header extended beyond the viewport even though the root hid horizontal overflow.
- Fix: allow navigation wrapping and reduce its narrow-screen spacing.
- Check: compare visible element bounds with the viewport at 320px and 390px, then inspect an actual screenshot.
  A `documentElement.scrollWidth` check alone can miss clipped controls.

## Worktree creation can leave a branch after failure

- Observed: parallel SSH worktree preparation left one task queued with `a branch named ... already exists`.
- Cause: `git worktree add -b` can create the branch before a later filesystem step fails; retrying `-b` is not idempotent.
- Fix: serialize preparations for the same repository and reuse an existing task UUID branch without resetting it.
  Git must still reject branches checked out elsewhere; verify the resulting repository root and branch.
- Check: `tools/runtime-probe/workbench-smoke.mjs` seeds this partial state, then starts two task worktrees over SSH.

## Lazy syntax grammars need alias normalization

- Observed: the async highlighter loads canonical grammar names, while fenced code commonly uses `js`, `py`, or `sh`.
- Fix: preserve Refractor's aliases in `client/src/lib/code-languages.ts` before loading a grammar asynchronously.
- Check: render JavaScript/Python aliases and an unknown language in a browser; confirm highlighting, unchanged
  source text, and plain-text fallback. Refresh the alias metadata when upgrading Refractor.
