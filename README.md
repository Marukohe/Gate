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
  Projects needing attention come first. Click a project heading to reveal past sessions; active sessions stay visible.
  Full paths appear on hover, with short parent paths shown only for duplicate project names. Search reveals matches.
- **Filter:** use the filter icon beside a server to exclude directories and their descendants. Rules match session working paths.
- **Archive:** use the archive icon on a session to hide it in Gate. Restore it under **Session filters → Archived sessions**.
  Filtering and archiving affect this Gate only; running Codex sessions continue.
- **Continue:** open a session to read history and send messages. During a running turn, messages steer that turn.
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
