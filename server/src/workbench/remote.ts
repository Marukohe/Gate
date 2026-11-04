import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { TaskResult } from './types.js';
import { fileURLToPath } from 'node:url';
import { SSHManager } from '../ssh-manager.js';
import type { Database } from '../db.js';

export interface RuntimeSettings {
  serverId: string;
  nodePath: string;
  claudePath: string;
  codexPath: string;
  directory: string;
  release?: string;
}
export interface LaunchSpec {
  command: string; args: string[]; cwd: string; initialInput: string; protocol: true;
}
export interface RemoteEvent {
  runId: string; seq: number; time: number; type: string; [key: string]: unknown;
}
export const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const bundle = ['runtime.mjs', 'cli.mjs', 'worker.mjs', 'provider.mjs', 'snapshot.mjs', 'verifier.mjs'].map((name) => ({ name,
  data: fs.readFileSync(fileURLToPath(new URL(`../../runtime/${name}`, import.meta.url))) }));
const build = createHash('sha256').update(Buffer.concat(bundle.map((file) => file.data))).digest('hex').slice(0, 16);

export class RemoteRuntime {
  private ssh = new SSHManager();
  private connecting = new Map<string, Promise<void>>();
  private installing = new Map<string, Promise<RuntimeSettings>>();
  private preparing = new Map<string, Promise<unknown>>();
  constructor(private db: Database) {}

  async connect(serverId: string): Promise<void> {
    const current = this.connecting.get(serverId);
    if (current) return current;
    const pending = (async () => {
      const machine = this.db.getServer(serverId);
      if (!machine) throw new Error('Server not found');
      if (this.ssh.isConnected(serverId)) await this.ssh.ensureConnected(serverId);
      else await this.ssh.connect(machine);
    })();
    this.connecting.set(serverId, pending);
    try { await pending; } finally { this.connecting.delete(serverId); }
  }

  async shell(serverId: string, command: string, input = ''): Promise<string> {
    await this.connect(serverId);
    const result = await this.ssh.execute(serverId, command, input);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Remote command exited ${result.exitCode}`);
    return result.stdout.trim();
  }

  releaseDirectory(settings: RuntimeSettings) { return settings.release ?? `${settings.directory}/releases/${build}`; }

  async install(settings: RuntimeSettings): Promise<RuntimeSettings> {
    const key = `${settings.serverId}:${settings.directory}`;
    const existing = this.installing.get(key);
    if (existing) return existing;
    const pending = this.installRelease({ ...settings, release: `${settings.directory}/releases/${build}` });
    this.installing.set(key, pending);
    try { return await pending; } finally { this.installing.delete(key); }
  }

  private async installRelease(settings: RuntimeSettings): Promise<RuntimeSettings> {
    const version = await this.shell(settings.serverId, `${quote(settings.nodePath)} -p 'process.versions.node'`);
    if (Number(version.split('.')[0]) < 20) throw new Error('Remote runtime requires Node.js 20 or newer');
    const target = this.releaseDirectory(settings);
    const installed = await this.shell(settings.serverId, `if test -f ${quote(`${target}/ready`)}; then printf ready; fi`);
    if (!installed) {
      await this.shell(settings.serverId, `umask 077; mkdir -p ${quote(target)}`);
      // Content-addressed filenames do not change beneath an already running adapter.
      for (const file of bundle) {
        await this.shell(settings.serverId, `umask 077; cat > ${quote(`${target}/${file.name}.new`)} && mv ${quote(`${target}/${file.name}.new`)} ${quote(`${target}/${file.name}`)}`, file.data.toString());
      }
      await this.shell(settings.serverId, `touch ${quote(`${target}/ready`)}`);
    }
    await this.shell(settings.serverId, `${quote(settings.nodePath)} ${quote(`${target}/cli.mjs`)} bootstrap ${quote(settings.directory)}`);
    return settings;
  }

  async request<T>(settings: RuntimeSettings, request: object): Promise<T> {
    const output = await this.shell(settings.serverId,
      `${quote(settings.nodePath)} ${quote(`${this.releaseDirectory(settings)}/cli.mjs`)} request ${quote(settings.directory)}`,
      JSON.stringify(request));
    return JSON.parse(output) as T;
  }

  async prepare(settings: RuntimeSettings, directory: string, source: string | null, branch: string | null): Promise<string> {
    const key = `${settings.serverId}:${source ?? directory}`;
    const previous = this.preparing.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.prepareCheckout(settings, directory, source, branch));
    this.preparing.set(key, pending);
    try { return await pending; } finally { if (this.preparing.get(key) === pending) this.preparing.delete(key); }
  }

  private async prepareCheckout(settings: RuntimeSettings, directory: string, source: string | null, branch: string | null): Promise<string> {
    if (settings.directory === directory || settings.directory.startsWith(directory + '/')) {
      throw new Error('Runtime data must be outside the checkout to keep journals out of code snapshots');
    }
    if (source) {
      const exists = await this.shell(settings.serverId, `if test -d ${quote(directory)}; then printf exists; fi`);
      if (!exists) {
        // A previous add may have created the task's UUID branch before failing to create its directory.
        // Reuse that branch without resetting it; Git still refuses a branch checked out elsewhere.
        const branchExists = await this.shell(settings.serverId,
          `if git -C ${quote(source)} show-ref --verify --quiet ${quote(`refs/heads/${branch}`)}; then printf exists; fi`);
        await this.shell(settings.serverId, branchExists
          ? `git -C ${quote(source)} worktree add ${quote(directory)} ${quote(branch!)}`
          : `git -C ${quote(source)} worktree add -b ${quote(branch!)} ${quote(directory)} HEAD`);
      }
    }
    const canonical = await this.shell(settings.serverId, `git -C ${quote(directory)} rev-parse --show-toplevel`);
    if (canonical !== directory) throw new Error('Checkout does not resolve to its registered repository root');
    if (source) {
      const actual = await this.shell(settings.serverId, `git -C ${quote(directory)} branch --show-current`);
      if (actual !== branch) throw new Error('Task worktree has an unexpected branch');
    }
    return this.shell(settings.serverId, `git -C ${quote(directory)} rev-parse HEAD`);
  }

  launch(settings: RuntimeSettings, provider: string, cwd: string, prompt: string): LaunchSpec {
    return { command: settings.nodePath, args: [`${this.releaseDirectory(settings)}/worker.mjs`], cwd, protocol: true,
      initialInput: JSON.stringify({ gateProtocol: 2, provider, executable: provider === 'codex' ? settings.codexPath : settings.claudePath,
        cwd, prompt }) + '\n' };
  }

  verification(settings: RuntimeSettings, cwd: string, command: string): LaunchSpec {
    return { command: settings.nodePath, args: [`${this.releaseDirectory(settings)}/verifier.mjs`], cwd, protocol: true,
      initialInput: JSON.stringify({ command, cwd }) + '\n' };
  }

  async result(settings: RuntimeSettings, cwd: string): Promise<TaskResult> {
    const ready = await this.install(settings);
    return JSON.parse(await this.shell(ready.serverId,
      `${quote(ready.nodePath)} ${quote(`${this.releaseDirectory(ready)}/snapshot.mjs`)}`,
      JSON.stringify({ method: 'result', cwd }))) as TaskResult;
  }

  async disconnect(): Promise<void> { await this.ssh.disconnectAll(); }
}
