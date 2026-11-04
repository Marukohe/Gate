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
