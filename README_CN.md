# Gate

[English](README.md) | [中文](README_CN.md)

**Gate** 是一个监控多台服务器上 AI 编程 sessions 的面板。
看清谁在运行、谁在等你、谁已经完成；需要处理时，直接打开对应 session。

```
浏览器 (React) <--HTTP/WebSocket--> Node.js 后端 <--SSH--> 远程服务器
                                     |
                               Provider Layer
                              Claude / Codex / ...
```

## Session 面板

![Session 监控面板](assets/session-monitor.png)

- **只有 Server 和 Sessions** — 同一页按服务器分组，支持搜索，不需要先建项目或任务。
- **直接看进展** — 每条 session 显示状态、最近活动和更新时间；同一 server 中待处理和失败项排在前面。
  断连、过期或没有运行证据时显示未知，不用聊天记录猜测进度。
- **直接操作** — 添加 server、编辑 SSH 连接、创建 Codex/Claude session、打开对话都从面板完成。
  托管 session 可直接打开日志、审批、停止操作或终端连接。
- **观察原生会话** — 终端启动的 Codex sessions 通过 SSH/SFTP 自动发现，已有 checkout hooks 也可报告活动。
  外部会话仍在原生终端中控制，面板不会为了监控而自动启动 CLI。
- **手机和桌面一致** — 支持深浅色和持久化历史。已有托管任务、工作区数据和旧链接继续保留。

## 快速开始

### 前置条件

- Node.js >= 20
- 一台有 SSH 访问权限的远程服务器，至少安装以下之一：
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — 在服务器上运行一次 `claude` 完成认证
  - [OpenAI Codex CLI](https://github.com/openai/codex) — 在服务器上运行一次 `codex` 完成认证

### 通过 npm 安装（推荐）

```bash
npm i -g @marukohe/gate
gate
```

在浏览器中打开 `http://localhost:3030`。数据存储在 `~/.gate/`。

CLI 选项：

```bash
gate --port 8080          # 自定义端口（默认 3030）
gate --host 127.0.0.1     # 绑定地址（默认 0.0.0.0）
gate --data-dir /my/data  # 自定义数据目录（默认 ~/.gate）
```

### 添加服务器

点击 **Add server** → 填入 SSH 凭据（密码或私钥）。该 SSH 用户 `~/.codex` 下的已有会话会自动出现，
也可以使用 server 旁的 **+ Session** 从 Gate 创建会话。

## 开发

默认界面及状态定义见[Session 监控说明](docs/session-monitor.md)。修改前阅读 [LESSONS.md](LESSONS.md)，
文档只保留当前使用方式和架构说明，不提交实施日志、进度流水或验收报告。

### 设置

```bash
git clone https://github.com/Marukohe/Gate.git gate
cd gate
npm install
npm run dev
```

客户端运行在 `http://localhost:5173`（API/WS 代理到 3030 端口的服务端）。

### 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动客户端和服务端 |
| `npm run dev:client` | 仅启动 Vite 开发服务器（5173 端口） |
| `npm run dev:server` | 仅启动 Express + WS 服务端（3030 端口） |
| `npm run build` | 构建客户端和服务端 |
| `npm run start` | 启动生产环境服务端 |
| `cd server && npx vitest run` | 运行服务端测试 |
| `cd server && npx tsc --noEmit` | 服务端类型检查 |

## 项目结构

```
gate/
├── client/                      # React 前端
│   └── src/
│       ├── components/
│       │   ├── chat/            # ChatView, SessionBar, MessageBubble, ToolActivityBlock,
│       │   │                    # ChatInput, ProviderSwitcher, ResumeChatDialog, BranchSwitcher
│       │   ├── layout/          # AppHeader, AppShell
│       │   ├── plan/            # PlanPanel, PlanStepItem
│       │   ├── plan-mode/       # PlanModeOverlay, PlanModeQuestion, PlanModeThinking
│       │   ├── server/          # ServerDialog
│       │   ├── workspace/       # WorkspaceHome, WorkspaceStart, WorkspaceInspector, WorkspaceActionBar
│       │   └── ui/              # shadcn/ui 组件
│       ├── hooks/               # use-websocket, use-swipe
│       ├── stores/              # Zustand stores (server, session, chat, git, plan, workspace, ui)
│       └── lib/                 # 工具函数 (plan-parser, provider-colors, server-utils, notification)
├── server/                      # Node.js 后端
│   └── src/
│       ├── index.ts             # Express 入口
│       ├── db.ts                # SQLite (servers, sessions, messages)
│       ├── ssh-manager.ts       # SSH 连接池 + CLI 通道管理
│       ├── ssh-browse.ts        # 远程目录浏览
│       ├── repo-scripts.ts      # 可选 gate.json 脚本解析
│       ├── git-utils.ts         # Git 命令辅助函数
│       ├── workspace-actions.ts # Workspace 交付动作状态
│       ├── workspace-inspector.ts # Workspace Inspector 快照
│       ├── ws-handler.ts        # WebSocket 服务端
│       ├── routes/              # REST API
│       ├── providers/
│       │   ├── types.ts         # CLIProvider 接口, OutputParser, ParsedMessage
│       │   ├── registry.ts      # Provider 注册与查找
│       │   ├── claude/          # Claude Code CLI provider
│       │   └── codex/           # OpenAI Codex CLI provider
│       └── __tests__/           # Vitest 测试套件
└── docs/                        # 设计文档
```

## 技术栈

**客户端：** Vite · React 19 · TypeScript · Tailwind CSS · shadcn/ui · Zustand

**服务端：** Express 5 · ws · ssh2 · better-sqlite3 · TypeScript

**测试：** Vitest

## WebSocket 协议

客户端 → 服务端：
```jsonc
{ "type": "connect" | "input" | "disconnect", "serverId": "...", "sessionId": "...", "text": "..." }
{ "type": "switch-provider", "serverId": "...", "sessionId": "...", "provider": "codex" }
{ "type": "reset-conversation" | "resume-cli-session", "serverId": "...", "sessionId": "...", "claudeSessionId": "..." }
{ "type": "list-cli-sessions", "serverId": "...", "workingDir": "...", "provider": "claude" }
{ "type": "exec", "serverId": "...", "sessionId": "...", "workspaceId": "...", "command": "git status", "terminal": true, "requestId": "..." }
{ "type": "list-workspaces" | "create-workspace" | "update-workspace" | "delete-workspace", "workspaceId": "...", ... }
{ "type": "start-workspace-task", "workspaceId": "...", "goal": "...", "provider": "claude", "branchMode": "create", "worktreeMode": "isolated" }
{ "type": "fetch-workspace-inspector" | "run-workspace-script" | "run-workspace-action", "workspaceId": "...", ... }
```

服务端 → 客户端：
```jsonc
{ "type": "message" | "status" | "history" | "sessions" | "git-info", "serverId": "...", ... }
{ "type": "cli-sessions", "serverId": "...", "sessions": ["..."] }
{ "type": "exec-result", "workspaceId": "...", "requestId": "...", "stdout": "...", "stderr": "...", "exitCode": 0 }
{ "type": "workspace-list" | "workspace-update" | "workspace-deleted" | "workspace-task-started", "workspaceId": "...", ... }
{ "type": "workspace-inspector" | "workspace-run-result" | "workspace-action-result", "workspaceId": "...", ... }
```

## 响应式布局

| 断点 | 布局 |
|------|------|
| 桌面（≥1024px） | 按 server 分组，紧凑展示 session 进展和状态 |
| 平板（768–1023px） | 相同面板，按需打开 session 详情 |
| 手机（<768px） | 单列布局，保留 server 操作和 session 状态 |


## 为什么叫 "Gate"？

取自《命运石之门》(*Steins;Gate*) — 那部消息穿越时间改变世界线的动画。在这里，你的消息通过 SSH 穿越到远程服务器上的 Claude，为你的任何设备和编程环境之间打开一扇门。

## 许可证

MIT
