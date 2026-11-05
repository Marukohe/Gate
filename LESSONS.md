# Lessons

- Gate's core is servers and native sessions. Simplify the underlying connection path along with the UI;
  hiding task menus while retaining multiple execution systems does not reduce complexity.
- A saved conversation ID does not identify a live process. Use the same Codex shared backend as the terminal;
  a fresh `exec resume` process cannot take over an in-flight turn.
- Correlate JSON-RPC responses by ID. Server requests with IDs are approvals/questions, not ordinary responses.
  Approval IDs belong to their connection. Do not replay inputs or decisions after timeout/disconnection.
- Subscribe to a native thread before reading its paginated history; sharing a socket backend alone is not a subscription.
- Monitoring uses native thread status and must not start agent turns. Mark retained snapshots unknown on connection loss.
- Non-interactive SSH can have a different PATH. Support an explicit Codex executable and its adjacent Node.js binary.
- Native addons follow the active Node.js ABI. For `ERR_DLOPEN_FAILED`, rebuild `better-sqlite3` with that Node installation.
- Inspect port ownership before stopping development services. Never stop an unrelated project or a shared Codex daemon.
- Preserve old database history when removing workflows; connection removal must not erase archived conversations.
- Check actual control bounds at 320px and 390px. Hidden overflow can conceal clipped controls.
- Keep generated output out of Git, and clean the server build directory so removed modules are not shipped in npm packages.
- Group repositories by their full Git root, sharing the common directory for linked worktrees; names and remote URLs
  alone can merge unrelated clones. Directory lookup failure must not hide sessions or change their native status.
