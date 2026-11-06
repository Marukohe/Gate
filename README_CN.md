# Gate

[English](README.md) | [中文](README_CN.md)

Gate 是监控多台 SSH 服务器上 Codex 会话的简单面板。
查看运行进展，打开对话，在浏览器或终端继续同一个会话。

![Session 面板](assets/session-monitor.png)

## 工作方式

Gate 通过 SSH 连接服务器上的 **Codex 共享后台**。会话、历史、工具和执行由 Codex 管理，
Gate 提供面板、聊天、审批和中断操作。关闭 Gate 不会停止 Codex。
只有这一种连接方式：没有 Gate Runtime、任务编排、hook、会话文件扫描或逐轮启动 CLI。

## 开始使用

1. 在运行 Gate 的机器上安装 Node.js 20+。
2. 各 SSH 服务器安装支持 `codex app-server daemon` 的 Codex CLI（已验证 0.166.0），并完成登录。
   旧版 CLI 需要升级，Gate 不提供备用执行方式。
3. 运行：

   ```bash
   npm i -g @marukohe/gate
   gate
   ```

4. 打开 `http://localhost:3030`，点击 **Add server**，填写 SSH 连接信息。
   如果 SSH 登录 PATH 中找不到 `codex`，填写其绝对可执行文件路径。

Gate 连接原生后台；后台尚未运行时会启动它，已有后台不会被重启。
SSH 服务器需要允许 Unix socket 转发，无需公开 Codex 网络端口。
使用与终端相同的远端系统用户和 Codex 配置。

## 日常使用

- **监控**：同一页按服务器、仓库归类会话，同仓库的 worktree 合并。需要回应的项目优先显示，
  点击项目标题展开历史，收起时保留活跃会话；搜索直接显示匹配结果。完整路径悬停查看，
  只有重名项目才显示简短父目录。非 Git 目录按工作目录分组。
- **过滤**：点击服务器旁的过滤图标，从已发现的目录中勾选要屏蔽的目录，支持搜索。
  已屏蔽目录仍保留在列表中，可以取消勾选；勾选父目录包含其子目录，按会话实际工作路径匹配。
- **归档**：点击会话行的归档图标，在 Gate 中隐藏会话；在 **Session filters → Archived sessions** 中可恢复。
  过滤和归档只影响这个 Gate 的显示，Codex 会话继续运行。
- **继续**：打开会话查看历史并发消息。当前轮次正在运行时，新消息用于补充指令。
- **新建**：点击 **+ Session**，填写工作目录和第一条指令，直接创建 Codex 原生会话。
- **回应**：在对话中回答问题、允许或拒绝操作。Gate 尚不支持的请求仍会显示，可在 Codex 终端处理。
- **中断**：停止当前轮次，不关闭共享后台。

Gate 只通过所连接的共享后台操作会话，无法接管独立的 `codex --no-daemon` 进程。
连接异常时明确报错；未确认送达的消息不会自动重发。
状态与连接细节见 [Session 说明](docs/session-monitor.md)。

Gate 用于可信内网，不提供身份认证。
SSH 配置、目录过滤和 Gate 归档保存在 `~/.gate/gate.db`，密码不会返回浏览器。
显示配置在 Gate 重启后仍生效，所有访问此 Gate 的浏览器共用。
旧数据库中的 Gate 数据保留为不再使用的归档；当前会话历史由 Codex 保存。

```bash
gate --port 8080
gate --host 127.0.0.1
gate --data-dir /custom/path
```

## 开发

```bash
npm install
npm run dev           # 前端 :5173，后端 :3030
npm run build
npm test --workspace=server -- --run
npx playwright install chromium
npm run test:ui       # build first
```

前端：React、TypeScript、Vite、Tailwind。后端：Express、ssh2、ws，SQLite 保存连接配置和显示偏好。
修改前阅读 [AGENTS.md](AGENTS.md) 和 [LESSONS.md](LESSONS.md)。
文档只保留当前使用方式和架构，不提交实施日志、进度流水或验收报告。
