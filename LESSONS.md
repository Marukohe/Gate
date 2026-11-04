# Lessons

Keep reusable prevention rules here, not implementation history or test-run reports.

## Product and UI

- Gate's primary job is monitoring sessions grouped by server. Do not require project/task workflows or add
  navigation layers to perform that job.
- Saved conversation IDs are not live process handles. Listing history must not launch a CLI; externally resumed
  conversations remain observed. Returning to the panel must clear automatic CLI reconnect intent.
- Check visible control bounds at 320px and 390px and inspect screenshots. Hidden horizontal overflow can conceal
  clipped controls. See `tools/runtime-probe/monitor-smoke.mjs`.
- Sibling React keys must include the component role as well as the record ID; otherwise polling can duplicate forms.
- Normalize syntax-highlighting aliases before lazy loading grammars; unknown languages should render plain text.

## Development environment

- Native addons follow the active Node.js ABI. For `ERR_DLOPEN_FAILED`, check Node/ABI and rebuild `better-sqlite3`
  with that Node installation before changing database code.
- Inspect port ownership before stopping development services; Vite choosing another port is not a backend failure.
- Probe non-interactive SSH directly. Use explicit executable paths and supply the configured Node.js directory to
  repository scripts rather than relying on interactive shell startup files.
- Check installed CLI flags and real argument parsing; do not replace removed flags with unrestricted execution.
- Keep executable test fixtures in separate files to avoid an extra shell/string escaping layer.

## Runtime and providers

- Keep the runtime socket available until owned children exit. Shutdown acknowledgement is not confirmed cleanup.
  Never kill a process from a stale persisted PID.
- A PTY shell can own several process groups. Clean the owned session before reaping its leader and require cleanup
  confirmation before releasing its checkout. Native Codex must use `--no-daemon` to retain lifecycle ownership.
- Pin both worker and transport client versions per run. Serialize runtime upgrades with starts and refuse upgrades
  while active or lost ownership remains.
- Wait for the exact input ID's acknowledgement before testing disconnect survival. Never automatically replay
  uncertain keystrokes; retain the private HMAC key with terminal journals.
- Stored login status does not prove credentials work. Keep initialization separate from authenticated model calls.
- Offer only provider-supported decision choices. Cancellation remains interrupted until confirmed exit; it must
  not mark a task ready for review or release its checkout early.
- Installed hooks do not prove event delivery, process ownership, or native trust. Silent hooks imply unknown status;
  keep trust decisions explicit. See `server/src/__tests__/monitor.test.ts` and `tools/runtime-probe/hooks-cli.test.mjs`.
- Empty provider configuration tables can merge with inherited entries. Disable inherited MCP/plugins individually
  when a review requires isolation.

## Persistence and Git

- Finish SQLite iterator reads before writing migration projections. Use bounded `.all()` pages when necessary.
- Backfill new projections without rewinding consumed event cursors or replaying commands.
- Persist explicit result/error metadata. Do not infer completion from assistant text, historical messages, or a
  disconnected channel.
- Worktree creation can leave a branch after failure. Serialize preparation and reuse the task's existing branch
  without resetting it; let Git reject branches already checked out elsewhere.
- Review belongs to its fixed snapshot. Completion must not overwrite concurrent task state or imply newer code
  was reviewed.
- Git fetch and push URLs can differ. Verify publication against the previewed push destination.
