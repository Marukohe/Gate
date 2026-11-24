# Gate

[English](README.md) | [中文](README_CN.md)

Gate is a simple panel for Codex sessions across SSH servers.
See what is running, open a conversation, and continue the same session from your browser or terminal.

![Session panel](assets/session-monitor.png)

## How it works

Gate connects through SSH to each server's **existing Codex shared backend**. Codex owns the sessions,
conversation history, tools, and execution. Gate provides the panel, messages, approvals, and interruption controls.
Closing Gate does not stop Codex. There is one connection model: no Gate runtime, task orchestration, hooks,
transcript scanning, or per-message CLI processes.

## Get started

1. Install Node.js 20+ on the machine running Gate.
2. Install a Codex CLI with `codex app-server daemon` support on each SSH server (tested with 0.166.0).
   Sign in to Codex there. Older CLI versions must be updated; Gate does not use a fallback execution mode.
3. Run:

   ```bash
   npm i -g @marukohe/gate
   gate
   ```

4. Open `http://localhost:3030`, choose **Add server**, and enter your SSH connection details.
   If `codex` is not on the SSH login PATH, set its absolute executable path.

Gate connects to the native daemon, starting it if necessary without restarting an existing backend.
The SSH server must allow Unix socket forwarding. No public Codex port is required.
Use the same remote OS user and Codex configuration as your terminal.

## Everyday use

- **Monitor:** one page groups sessions by server and repository. Worktrees share their repository group.
  Projects needing attention come first. Active sessions show by default. Click a project heading to reveal history
  or collapse its sessions; running-only projects can also be collapsed.
  Full paths appear on hover, with short parent paths shown only for duplicate project names. Search reveals matches.
- **Quick filters:** click **Running** or **Needs you** to show matching sessions, grouped by server and repository.
  Click the selected card again to show all sessions. The filter stays selected when returning from a conversation.
- **Conversation layout:** one compact header contains back navigation, the session name, and status counts.
  Click the name for server, directory, full status, rename, theme, or the session overview.
- **Session status:** while chatting, the header shows other sessions needing attention and all running sessions,
  including the current conversation. The running list marks it **Current**. Click either count
  to switch sessions. New waits and native session errors show a brief notice with the server and reason.
  Opening or dismissing a notice leaves pending work in the list until its state changes.
  After switching, the back arrow returns to the original conversation; the forward arrow opens the next pending one.
  Drafts, model/effort choices, and reading positions stay
  in browser memory while the page remains open; reloading clears them.
- **Filter:** use the filter icon beside a server. Search **Available directories** and click **Hide**.
  **Blocked directories** stays collapsed; expand it and click **Show** to unblock a path.
  Use **Add another directory** for a custom parent path.
  Saved rules include existing and future descendants and match session working paths.
- **Archive:** use the archive icon on a session to hide it in Gate. Restore it under **Session filters → Archived sessions**.
  Filtering and archiving affect this Gate only; running Codex sessions continue.
- **Continue:** open a session to read history and send messages. During a running turn, messages steer that turn.
  Scroll up to load earlier messages automatically without losing your reading position. **Earlier messages** also
  works for manual loading. If loading fails, click it to retry; scrolling does not keep retrying the failed request.
  Scrolling up pauses automatic following; scroll back down near the bottom to follow new output again.
  History loads in place; background refreshes preserve newer live output received during the request.
- **Attach images:** click the image button beside the input, paste a screenshot, or drop images onto the composer.
  Review thumbnails and remove attachments before sending; text is optional. Supports PNG, JPEG, WebP and GIF,
  up to 4 images, 5 MB each and 10 MB total per message. Unsent attachments survive session switching in this tab;
  page reload clears drafts. Sent images are part of native Codex history and can be clicked to enlarge.
  Remove attachments before using a `!` shell command.
- **Files and images:** local Markdown links open files from the session's server in a new tab, including line references
  such as `main.ts:42` or `main.ts#L42`. Relative paths use the session's working directory; local images display inline.
  Gate reads through the existing SSH connection (SFTP), up to 10 MB per file. Text up to 1 MB is previewed; other files download.
- **Shell:** send `!pwd`, `!git status`, or another `!command` to execute directly through SSH in the session's working
  directory, without model inference. Results show stdout, stderr, and exit status; they survive switching sessions but
  clear on page reload and are never added to model context. Each command uses a fresh, non-interactive shell, with a
  60-second wait limit and up to 128,000 output characters. Directory/environment changes do not carry to later commands.
- **Model and reasoning:** select a model and its supported reasoning effort above the message input before a new turn.
  Choices and default efforts come from that server's Codex catalog. Changes take effect when the message is sent
  and become the session defaults; running turns keep their current settings.
- **Rename:** click the conversation title, then **Rename**. Names are saved in Codex and shared with the terminal.
- **Start:** click **+ Session**, enter a working directory and first instruction. This creates a native Codex session.
- **Respond:** answer questions or allow/decline requested operations in the conversation. Requests unsupported by
  Gate remain visible and can be handled in the Codex terminal.
- **Interrupt:** stop the current turn without shutting down the shared backend.

Gate only controls sessions through the connected shared backend. It cannot attach to a separate
`codex --no-daemon` process. Missing connections show an error; uncertain writes are never resent automatically.
See [session behavior](docs/session-monitor.md) for status and connection details.

Gate is intended for trusted internal networks and has no authentication.
SSH settings, directory filters, and Gate archives are stored in `~/.gate/gate.db`; passwords are not returned to the browser.
Display preferences survive Gate restarts and apply to every browser using this Gate.
Existing databases retain their older Gate data as inactive archives. Active history lives in Codex.

```bash
gate --port 8080
gate --host 127.0.0.1
gate --data-dir /custom/path
```

## Development

```bash
npm install
npm run dev           # client :5173, server :3030
npm run build
npm test --workspace=server -- --run
npx playwright install chromium
npm run test:ui       # build first
```

Client: React, TypeScript, Vite, Tailwind. Server: Express, ssh2, ws, SQLite for connection settings and display preferences.
Read [AGENTS.md](AGENTS.md) and [LESSONS.md](LESSONS.md) before making changes.
Keep documentation about current usage and architecture; do not commit work journals or validation reports.
