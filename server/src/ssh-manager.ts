import { Client, type ConnectConfig } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { parseRepoScripts, type RepoScripts } from './repo-scripts.js';

export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
}

interface SSHConnection {
  client: Client;
  channels: Map<string, ClientChannel>;  // sessionId → channel
}

export interface GitInfo {
  branch: string;
  worktree: string;
}

export interface BranchList {
  current: string;
  local: string[];
  remote: string[];
}

export interface WorkspaceStartGitOptions {
  branchMode?: 'current' | 'existing' | 'create';
  branchName?: string | null;
  worktreeMode?: 'main' | 'isolated' | 'existing';
  worktreePath?: string | null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Return a shell-safe cd expression. Replaces leading ~ with $HOME so it works unquoted. */
function shellCd(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) {
    const suffix = dir.slice(2);
    return suffix ? `cd "$HOME/${suffix.replace(/"/g, '\\"')}"` : 'cd "$HOME"';
  }
  return `cd ${shellQuote(dir)}`;
}

function worktreeSlug(branchName: string): string {
  return branchName
    .replace(/^[^/]+\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `task-${Date.now()}`;
}

function cleanCommitMessage(output: string): string {
  const trimmed = output
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const line = trimmed
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? '';
  return line
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^commit message:\s*/i, '')
    .trim()
    .slice(0, 120);
}

export interface GitProbeResult {
  canonicalPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
}

/**
 * Parse the output of the four-line git probe command.
 * Stdin (stdout-like) lines are, in order:
 *  1. `git rev-parse --show-toplevel`
 *  2. `git rev-parse --path-format=absolute --git-common-dir`
 *  3. `git config --get remote.origin.url`  (may be empty)
 *  4. either `git symbolic-ref refs/remotes/origin/HEAD` (e.g. refs/remotes/origin/main)
 *     or `git rev-parse --abbrev-ref HEAD` (e.g. main) as fallback
 *
 * Returns null when toplevel is empty (non-git working dir).
 */
export function parseGitProbeOutput(stdout: string): GitProbeResult | null {
  const lines = stdout.split('\n').map((l) => l.trim());
  const toplevel = lines[0] || '';
  if (!toplevel) return null;

  const commonDirRaw = lines[1] || '';
  // For a main worktree, `--git-common-dir` is `<repo>/.git`; for a secondary
  // worktree it points at the same `<main-repo>/.git`. Repo-style checkouts
  // keep git metadata under `.repo/projects`, which is not the working tree.
  let canonicalPath = toplevel;
  if (commonDirRaw && commonDirRaw.startsWith('/') && !commonDirRaw.includes('/.repo/')) {
    canonicalPath = commonDirRaw.replace(/\/?\.git\/?$/, '') || toplevel;
  }

  const remoteUrl = (lines[2] || '').trim() || null;

  let defaultBranch: string | null = null;
  const branchLine = lines[3] || '';
  if (branchLine.startsWith('refs/remotes/origin/')) {
    defaultBranch = branchLine.replace(/^refs\/remotes\/origin\//, '');
  } else if (branchLine) {
    defaultBranch = branchLine;
  }

  return { canonicalPath, remoteUrl, defaultBranch };
}

export class SSHManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();
  private configs = new Map<string, ServerConfig>();

  async connect(config: ServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }
    this.configs.set(config.id, config);

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        this.connections.set(config.id, { client, channels: new Map() });
        this.emit('status', config.id, null, 'connected');
        resolve();
      });

      client.on('error', (err) => {
        this.connections.delete(config.id);
        this.emit('status', config.id, null, 'error', err.message);
        reject(err);
      });

      client.on('close', () => {
        this.connections.delete(config.id);
        this.emit('status', config.id, null, 'disconnected');
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
      };

      if (config.authType === 'password') {
        connectConfig.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(config.privateKeyPath);
      }

      client.connect(connectConfig);
    });
  }

  /** Reconnect using the last known config. */
  private async reconnect(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`No saved config for server ${serverId}`);
    await this.connect(config);
  }

  /** Quick ping to verify the SSH connection is still alive. */
  private async checkAlive(serverId: string): Promise<boolean> {
    const conn = this.connections.get(serverId);
    if (!conn) return false;
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => done(false), 3_000);
      conn.client.exec('echo 1', (err, ch) => {
        if (err) return done(false);
        ch.on('close', () => done(true));
        ch.on('error', () => done(false));
        ch.on('data', () => {});
        ch.stderr.on('data', () => {});
      });
    });
  }

  /** Ensure the SSH connection for a server is alive, reconnecting if stale. */
  async ensureConnected(serverId: string): Promise<void> {
    if (this.connections.has(serverId)) {
      const alive = await this.checkAlive(serverId);
      if (alive) return;
      // Stale — tear down and reconnect
      this.connections.delete(serverId);
    }
    await this.reconnect(serverId);
  }

  /** Launch a CLI tool via SSH exec on a new channel. The caller provides the full command. */
  async startCLI(serverId: string, sessionId: string, command: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    // Close existing channel for this session if any
    const existing = conn.channels.get(sessionId);
    if (existing) {
      existing.end();
      conn.channels.delete(sessionId);
    }

    const cmd = command;
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI launch timed out')), 10_000);
      conn.client.exec(cmd, (err, ch) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        resolve(ch);
      });
    });

    conn.channels.set(sessionId, channel);

    channel.on('data', (data: Buffer) => {
      this.emit('data', serverId, sessionId, data.toString());
    });

    channel.stderr.on('data', (data: Buffer) => {
      this.emit('stderr', serverId, sessionId, data.toString());
    });

    channel.on('close', () => {
      channel.removeAllListeners();
      conn.channels.delete(sessionId);
      this.emit('status', serverId, sessionId, 'disconnected');
    });

    channel.on('error', (err: Error) => {
      console.error(`[ssh] channel error for ${serverId}:${sessionId}:`, err.message);
      channel.removeAllListeners();
      conn.channels.delete(sessionId);
      this.emit('status', serverId, sessionId, 'disconnected');
    });
  }

  /** Write pre-formatted input to the CLI's stdin. The provider is responsible for formatting. */
  sendInput(serverId: string, sessionId: string, formattedInput: string): void {
    const conn = this.connections.get(serverId);
    const channel = conn?.channels.get(sessionId);
    if (!channel) {
      throw new Error(`No active channel for server ${serverId} session ${sessionId}`);
    }
    channel.write(formattedInput);
  }

  /** Write raw text to the channel stdin (for CLI prompts that bypass stream-json). */
  writeRaw(serverId: string, sessionId: string, data: string): void {
    const conn = this.connections.get(serverId);
    const channel = conn?.channels.get(sessionId);
    if (channel) channel.write(data);
  }

  /** Close a single session channel without dropping the SSH connection. */
  stopSession(serverId: string, sessionId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    const channel = conn.channels.get(sessionId);
    if (channel) {
      channel.end();
      conn.channels.delete(sessionId);
    }
  }

  /** Run a one-shot command over SSH and return stdout, stderr, and exit code. */
  async runCommand(
    serverId: string,
    workingDir: string | null,
    command: string,
    timeoutMs = 30_000,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    const cdPrefix = workingDir ? `${shellCd(workingDir)} && ` : 'cd $HOME && ';
    const cmd = `$SHELL -lc "${cdPrefix}${command.replace(/"/g, '\\"')}"`;

    return new Promise((resolve, reject) => {
      conn.client.exec(cmd, (err, channel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        let settled = false;

        const finish = (result: { stdout: string; stderr: string; exitCode: number } | null, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          channel.removeAllListeners();
          if (error) reject(error); else resolve(result!);
        };

        const timeout = setTimeout(() => {
          channel.close();
          finish(null, new Error(`Command timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);

        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        channel.on('close', (code: number) => {
          exitCode = code ?? 0;
          finish({ stdout, stderr, exitCode });
        });
        channel.on('error', (err: Error) => finish(null, err));
      });
    });
  }

  /** Close all channels and the SSH connection. */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    for (const channel of conn.channels.values()) {
      channel.end();
    }
    conn.channels.clear();
    conn.client.end();
    this.connections.delete(serverId);
  }

  /** Run a one-shot command over SSH and return stdout. */
  private async execCommand(serverId: string, cmd: string): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    return new Promise((resolve, reject) => {
      conn.client.exec(cmd, (err, channel) => {
        if (err) return reject(err);
        let stdout = '';
        let settled = false;
        const done = (result: string | null, error?: Error) => {
          if (settled) return;
          settled = true;
          channel.removeAllListeners();
          if (error) reject(error); else resolve(result!);
        };
        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.on('close', () => done(stdout.trim()));
        channel.on('error', (err: Error) => done(null, err));
        channel.stderr.on('data', () => {});
      });
    });
  }

  /**
   * Probe a remote working dir to identify its git repository.
   * Returns null for non-git dirs. Batches four git commands in one round-trip.
   */
  async probeGitRepo(serverId: string, workingDir: string): Promise<GitProbeResult | null> {
    const cd = shellCd(workingDir);
    // `|| echo ''` ensures missing remote / detached HEAD don't make the script exit early
    const cmd = `${cd} && (git rev-parse --show-toplevel 2>/dev/null; ` +
      `git rev-parse --path-format=absolute --git-common-dir 2>/dev/null; ` +
      `git config --get remote.origin.url 2>/dev/null || echo ''; ` +
      `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null)`;
    try {
      const out = await this.execCommand(serverId, cmd);
      return parseGitProbeOutput(out);
    } catch {
      return null;
    }
  }

  /** Fetch git branch and worktree root for a directory. */
  async fetchGitInfo(serverId: string, workingDir: string): Promise<GitInfo | null> {
    try {
      const cmd = `${shellCd(workingDir)} && git rev-parse --abbrev-ref HEAD && git rev-parse --show-toplevel`;
      const output = await this.execCommand(serverId, cmd);
      const lines = output.split('\n');
      if (lines.length < 2 || !lines[0]) return null;
      return { branch: lines[0], worktree: lines[1] };
    } catch {
      return null;
    }
  }

  /** List local and remote branches. */
  async listBranches(serverId: string, workingDir: string): Promise<BranchList> {
    const cd = shellCd(workingDir);
    const current = await this.execCommand(serverId,
      `${cd} && git rev-parse --abbrev-ref HEAD`);
    const localRaw = await this.execCommand(serverId,
      `${cd} && git branch --format='%(refname:short)'`);
    const remoteRaw = await this.execCommand(serverId,
      `${cd} && git branch -r --format='%(refname:short)'`);
    const local = localRaw.split('\n').filter(Boolean);
    // Filter out HEAD pointers like "origin/HEAD"
    const remote = remoteRaw.split('\n').filter((b) => b && !b.endsWith('/HEAD'));
    return { current, local, remote };
  }

  /** Switch branch and return the new git info. */
  async switchBranch(serverId: string, workingDir: string, branch: string): Promise<GitInfo> {
    await this.execCommand(serverId, `${shellCd(workingDir)} && git checkout ${shellQuote(branch)}`);
    const info = await this.fetchGitInfo(serverId, workingDir);
    if (!info) throw new Error('Failed to read git info after checkout');
    return info;
  }

  /** Prepare the checkout/worktree to use before starting a workspace task. */
  async prepareWorkspaceStart(
    serverId: string,
    repoPath: string,
    options: WorkspaceStartGitOptions,
  ): Promise<{ workingDir: string; gitInfo: GitInfo | null }> {
    const branchMode = options.branchMode ?? 'current';
    const branchName = options.branchName?.trim() || null;
    const worktreeMode = options.worktreeMode ?? 'main';

    if (worktreeMode === 'existing') {
      if (!options.worktreePath?.trim()) throw new Error('Existing worktree path required');
      const workingDir = options.worktreePath.trim();
      if (branchMode === 'existing') {
        if (!branchName) throw new Error('Branch name required');
        return { workingDir, gitInfo: await this.switchBranch(serverId, workingDir, branchName) };
      }
      if (branchMode === 'create') {
        if (!branchName) throw new Error('Branch name required');
        await this.execCommand(serverId, `${shellCd(workingDir)} && git check-ref-format --branch ${shellQuote(branchName)} && git checkout -b ${shellQuote(branchName)}`);
      }
      return { workingDir, gitInfo: await this.fetchGitInfo(serverId, workingDir) };
    }

    if (worktreeMode === 'isolated') {
      if (branchMode === 'current' || !branchName) {
        throw new Error('A branch name is required for an isolated worktree');
      }
      await this.execCommand(serverId, `${shellCd(repoPath)} && git check-ref-format --branch ${shellQuote(branchName)}`);
      const slug = worktreeSlug(branchName);
      const target = await this.execCommand(serverId,
        `${shellCd(repoPath)} && parent=$(dirname "$(git rev-parse --show-toplevel)") && ` +
        `base=$(basename "$(git rev-parse --show-toplevel)") && target="$parent/$base-${slug}" && ` +
        'i=1; while [ -e "$target" ]; do target="$parent/$base-' + slug + '-$i"; i=$((i+1)); done; printf "%s" "$target"',
      );
      const command = branchMode === 'create'
        ? `${shellCd(repoPath)} && git worktree add -b ${shellQuote(branchName)} ${shellQuote(target)} HEAD`
        : `${shellCd(repoPath)} && git worktree add ${shellQuote(target)} ${shellQuote(branchName)}`;
      await this.execCommand(serverId, command);
      return { workingDir: target, gitInfo: await this.fetchGitInfo(serverId, target) };
    }

    if (branchMode === 'existing') {
      if (!branchName) throw new Error('Branch name required');
      return { workingDir: repoPath, gitInfo: await this.switchBranch(serverId, repoPath, branchName) };
    }

    if (branchMode === 'create') {
      if (!branchName) throw new Error('Branch name required');
      await this.execCommand(serverId, `${shellCd(repoPath)} && git check-ref-format --branch ${shellQuote(branchName)} && git checkout -b ${shellQuote(branchName)}`);
      return { workingDir: repoPath, gitInfo: await this.fetchGitInfo(serverId, repoPath) };
    }

    return { workingDir: repoPath, gitInfo: await this.fetchGitInfo(serverId, repoPath) };
  }

  async readRepoScripts(serverId: string, workingDir: string): Promise<RepoScripts> {
    const raw = await this.execCommand(serverId, `${shellCd(workingDir)} && cat gate.json 2>/dev/null || true`);
    return parseRepoScripts(raw);
  }

  async runRepoScript(serverId: string, workingDir: string, command: string): Promise<string> {
    return this.execCommand(serverId, `${shellCd(workingDir)} && ${command}`);
  }

  /** Upload a file to the remote server via SFTP. Returns the remote path. */
  async uploadFile(serverId: string, remotePath: string, data: Buffer): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    return new Promise((resolve, reject) => {
      conn.client.sftp((err, sftp) => {
        if (err) return reject(err);
        const ws = sftp.createWriteStream(remotePath);
        ws.on('error', (e: Error) => { sftp.end(); reject(e); });
        ws.on('close', () => { sftp.end(); resolve(remotePath); });
        ws.end(data);
      });
    });
  }

  /** Get git status (porcelain format) for a working directory. */
  async fetchGitStatus(serverId: string, workingDir: string): Promise<string> {
    const { stdout } = await this.runCommand(serverId, workingDir, 'git status --porcelain');
    return stdout;
  }

  /** Get git diff for a working directory. diffArgs can be '--staged', a file path, etc. */
  async fetchGitDiff(serverId: string, workingDir: string, diffArgs: string = ''): Promise<string> {
    const { stdout } = await this.runCommand(serverId, workingDir, `git diff ${diffArgs}`);
    return stdout;
  }

  /** Create a git commit. */
  async gitCommit(serverId: string, workingDir: string, message: string, files?: string[]): Promise<string> {
    if (files && files.length > 0) {
      const escaped = files.map((f) => `'${f}'`).join(' ');
      await this.runCommand(serverId, workingDir, `git add ${escaped}`);
    }
    const { stdout } = await this.runCommand(serverId, workingDir, `git commit -m '${message.replace(/'/g, "'\\''")}'`);
    return stdout;
  }

  /** Create a GitHub PR using gh CLI. */
  async gitCreatePR(serverId: string, workingDir: string, title: string, body: string): Promise<string> {
    await this.runCommand(serverId, workingDir, 'git push -u origin HEAD');
    const { stdout } = await this.runCommand(serverId, workingDir,
      `gh pr create --title '${title.replace(/'/g, "'\\''")}'` +
      ` --body '${body.replace(/'/g, "'\\''")}'`);
    return stdout.trim();
  }

  async gitPush(serverId: string, workingDir: string): Promise<string> {
    const { stdout } = await this.runCommand(serverId, workingDir, 'git push -u origin HEAD');
    return stdout.trim();
  }

  async gitCommitAllAndPush(serverId: string, workingDir: string, message: string): Promise<string> {
    const staged = await this.runCommand(serverId, workingDir, 'git add -A');
    if (staged.exitCode !== 0) throw new Error(staged.stderr || staged.stdout || 'git add failed');

    const committed = await this.runCommand(serverId, workingDir, `git commit -m ${shellQuote(message)}`);
    if (committed.exitCode !== 0) throw new Error(committed.stderr || committed.stdout || 'git commit failed');

    const pushed = await this.runCommand(serverId, workingDir, 'git push -u origin HEAD');
    if (pushed.exitCode !== 0) throw new Error(pushed.stderr || pushed.stdout || 'git push failed');

    return [committed.stdout || committed.stderr, pushed.stdout || pushed.stderr]
      .map((part) => part.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  async generateCommitMessage(serverId: string, workingDir: string, preferredProvider?: string | null): Promise<string> {
    const context = await this.commitMessageContext(serverId, workingDir);
    const prompt = [
      'Generate exactly one concise git commit message for these changes.',
      'Rules:',
      '- Output only the commit message, no markdown, no quotes, no explanation.',
      '- Use imperative mood.',
      '- Keep it under 72 characters.',
      '- Prefer Conventional Commit style when a clear type is obvious.',
      '',
      context,
    ].join('\n');

    const providers = [
      preferredProvider === 'codex' ? 'codex' : preferredProvider === 'claude' ? 'claude' : null,
      'codex',
      'claude',
    ].filter((provider, index, all): provider is string => !!provider && all.indexOf(provider) === index);

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        const output = provider === 'claude'
          ? await this.generateCommitMessageWithClaude(serverId, workingDir, prompt)
          : await this.generateCommitMessageWithCodex(serverId, workingDir, prompt);
        const message = cleanCommitMessage(output);
        if (message) return message;
      } catch (err: any) {
        errors.push(`${provider}: ${err.message}`);
      }
    }
    throw new Error(`Commit message generation failed: ${errors.join('; ') || 'no provider available'}`);
  }

  private async commitMessageContext(serverId: string, workingDir: string): Promise<string> {
    const status = await this.runCommand(serverId, workingDir, 'git status --porcelain', 30_000);
    if (!status.stdout.trim()) throw new Error('No changes to summarize');

    const stat = await this.runCommand(serverId, workingDir, 'git diff --stat && git diff --cached --stat', 30_000);
    const names = await this.runCommand(serverId, workingDir, 'git diff --name-status && git diff --cached --name-status', 30_000);
    const sample = await this.runCommand(serverId, workingDir, 'git diff --unified=2 | head -220', 30_000);

    return [
      'Git status:',
      status.stdout.trim(),
      '',
      'Changed files:',
      names.stdout.trim() || '(none)',
      '',
      'Diff stat:',
      stat.stdout.trim() || '(none)',
      '',
      'Diff sample:',
      sample.stdout.trim() || '(no tracked diff sample)',
    ].join('\n').slice(0, 18_000);
  }

  private async generateCommitMessageWithCodex(serverId: string, workingDir: string, prompt: string): Promise<string> {
    const result = await this.runCommand(
      serverId,
      workingDir,
      `codex exec --full-auto ${shellQuote(prompt)}`,
      90_000,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || 'codex failed');
    return result.stdout || result.stderr;
  }

  private async generateCommitMessageWithClaude(serverId: string, workingDir: string, prompt: string): Promise<string> {
    const result = await this.runCommand(
      serverId,
      workingDir,
      `claude -p ${shellQuote(prompt)} --dangerously-skip-permissions`,
      90_000,
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || 'claude failed');
    return result.stdout || result.stderr;
  }

  /** Get PR info for current branch. */
  async fetchPRInfo(serverId: string, workingDir: string): Promise<string> {
    const { stdout } = await this.runCommand(serverId, workingDir,
      'gh pr view --json number,title,state,url,statusCheckRollup 2>/dev/null || echo ""');
    return stdout.trim();
  }

  /** Create a git checkpoint by committing current state and tagging it. */
  async createCheckpoint(serverId: string, workingDir: string, tagName: string): Promise<{ branch: string; commitSha: string }> {
    // Get current branch and commit
    const info = await this.fetchGitInfo(serverId, workingDir);
    const branch = info?.branch ?? 'unknown';
    const { stdout: sha } = await this.runCommand(serverId, workingDir, 'git rev-parse HEAD');
    const commitSha = sha.trim();

    // Stash any uncommitted changes into a checkpoint commit on a detached ref
    // Use git stash create to get a commit of current state without disturbing working tree
    const { stdout: stashSha } = await this.runCommand(serverId, workingDir, 'git stash create');
    const refSha = stashSha.trim() || commitSha;

    // Create a lightweight tag pointing to the current state
    await this.runCommand(serverId, workingDir, `git tag -f '${tagName}' '${refSha}'`);

    return { branch, commitSha: refSha };
  }

  /** Revert working directory to a checkpoint state. */
  async revertToCheckpoint(serverId: string, workingDir: string, tagName: string): Promise<void> {
    // Reset working tree to the checkpoint state
    // First, get the commit the tag points to
    const { stdout: tagSha } = await this.runCommand(serverId, workingDir, `git rev-parse '${tagName}'`);
    const sha = tagSha.trim();
    if (!sha) throw new Error(`Checkpoint tag not found: ${tagName}`);

    // Hard reset to the checkpoint (this restores all files)
    await this.runCommand(serverId, workingDir, `git checkout -f '${sha}' -- .`);
    // Clean untracked files that were added after the checkpoint
    await this.runCommand(serverId, workingDir, 'git clean -fd');
  }

  /** Disconnect all SSH connections. */
  async disconnectAll(): Promise<void> {
    const serverIds = [...this.connections.keys()];
    for (const id of serverIds) {
      await this.disconnect(id);
    }
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  /** True if SSH is connected AND the given session channel is still open. */
  hasActiveChannel(serverId: string, sessionId: string): boolean {
    const conn = this.connections.get(serverId);
    return conn?.channels.has(sessionId) ?? false;
  }
}
