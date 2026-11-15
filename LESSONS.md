# Lessons

- Gate's core is servers and native sessions. Simplify the underlying connection path along with the UI;
  hiding task menus while retaining multiple execution systems does not reduce complexity.
- Keep each project heading to one row and use it to reveal history or collapse sessions, including running-only groups.
  Paths and history controls should not add extra rows. Polling must preserve the user's collapsed state.
- Keep quick status filters above the monitor's component lifetime so returning from chat preserves the choice.
  Summary counts use the visible server snapshot before quick status/search filtering; filtered results expand automatically.
- Keep monitoring alive while viewing a session, with one shared poller. Notify on observed waiting/error transitions,
  excluding the current thread; initial snapshots, unchanged polls, and reconnects must not repeat old notices.
  Header Running includes the current session; Needs you and notices concern other sessions.
- Preserve drafts and reading positions by server plus thread ID. Carry in-flight action state across navigation,
  never replay a send, and refresh native state before acting on cached history. Do not restore cached approval IDs.
- Keep chat navigation, title, and status in one header row, including after attention jumps. Move metadata into the title
  popover and verify the conversation starts directly below the header at 320px, 390px, and desktop widths.
- Auto-load history only on upward scrolling near the top, with a synchronous in-flight guard. Anchor the visible message
  when prepending so simultaneous output below does not move the reading position; preserve the cursor on failure.
- Keep Markdown renderer components stable and skip unchanged message renders. Inline component definitions remount code
  blocks and tables on loading/poll updates, causing flicker and losing local table state; verify node identity as well as scroll.
- A saved conversation ID does not identify a live process. Use the same Codex shared backend as the terminal;
  a fresh `exec resume` process cannot take over an in-flight turn.
- Correlate JSON-RPC responses by ID. Server requests with IDs are approvals/questions, not ordinary responses.
  Approval IDs belong to their connection. Do not replay inputs or decisions after timeout/disconnection.
- Subscribe to a native thread before reading its paginated history; sharing a socket backend alone is not a subscription.
- Monitoring uses native thread status and must not start agent turns. Mark retained snapshots unknown on connection loss.
- Rename sessions through `thread/name/set` and handle `thread/name/updated`; keep native names shared across clients.
- Model choices come from paginated `model/list`; send the model slug, not the catalog entry ID, on `turn/start` only.
  Include supported/default reasoning efforts, reset the effort draft when changing models, and pass effort on new turns only.
  `turn/steer` cannot override a model or effort. A catalog failure must not disable ordinary chat.
- Non-interactive SSH can have a different PATH. Support an explicit Codex executable and its adjacent Node.js binary.
- Native addons follow the active Node.js ABI. For `ERR_DLOPEN_FAILED`, rebuild `better-sqlite3` with that Node installation.
- Inspect port ownership before stopping development services. Never stop an unrelated project or a shared Codex daemon.
- Preserve old database history when removing workflows; connection removal must not erase archived conversations.
- Check actual control bounds at 320px and 390px. Hidden overflow can conceal clipped controls.
- Enter-to-send must respect composition events and IME keyCode 229; isComposing can be false on the confirming Enter.
- Keep generated output out of Git, and clean the server build directory so removed modules are not shipped in npm packages.
- Group repositories by their full Git root, sharing the common directory for linked worktrees; names and remote URLs
  alone can merge unrelated clones. Directory lookup failure must not hide sessions or change their native status.
- Persist display filters on the Gate server, match directories at path boundaries, and scope archives by server and native
  session ID. Hiding a session must not stop it or invoke native archive/delete operations.
- Build filter choices from the unfiltered session snapshot plus saved rules, so hidden or missing directories can still
  be unblocked. Keep blocked paths in a collapsed list; retain custom parent paths to cover future subdirectories.
