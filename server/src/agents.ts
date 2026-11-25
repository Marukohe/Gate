import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { imageInputs } from './images.js';
import type { AgentBackend, BackendRegistration } from './agent-backend.js';
import type { Item, Server, ServerEvent } from './types.js';

export class AgentService extends EventEmitter implements AgentBackend {
  private owners = new Map<string, AgentBackend>();
  constructor(private registrations: BackendRegistration[]) {
    super();
    for (const { backend } of registrations) backend.on('event', (event: ServerEvent) => {
      if (this.owners.get(event.serverId) === backend) this.emit('event', event);
    });
  }
  tools() { return this.registrations.map(({ tool }) => tool); }
  sync(servers: Server[]) {
    const owners = new Map<string, AgentBackend>();
    for (const server of servers) {
      const entry = this.registrations.find(({ tool }) => tool.id === (server.tool || 'codex'));
      if (!entry) throw new Error(`Unsupported tool: ${server.tool}`);
      owners.set(server.id, entry.backend);
    }
    this.owners = owners;
    for (const { backend } of this.registrations) backend.sync(servers.filter((server) => owners.get(server.id) === backend));
  }
  private backend(id: string) {
    const backend = this.owners.get(id);
    if (!backend) throw new Error('Server not found');
    return backend;
  }
  monitor() { return { servers: this.registrations.flatMap(({ backend }) => backend.monitor().servers) }; }
  detail(id: string, session: string, cursor?: string) { return this.backend(id).detail(id, session, cursor); }
  create(id: string, cwd: string) { return this.backend(id).create(id, cwd); }
  models(id: string, session?: string) { return this.backend(id).models(id, session); }
  async input(id: string, session: string, text: string, turn?: string, model?: string, effort?: string, images?: unknown) {
    this.backend(id);
    if (text.trimStart().startsWith('!')) {
      if (imageInputs(images).length) throw new Error('Remove image attachments before running a shell command.');
      const command = text.trimStart().slice(1).trim();
      if (!command || command.length > 32_000 || command.includes('\0')) throw new Error('Invalid shell command');
      // Older open pages still post to /input. Classify here before any native turn RPC.
      const item: Item = { id: `shell-${randomUUID()}`, kind: 'tool', title: `$ ${command}`, text: '', status: 'Running…' };
      const publish = () => this.emit('event', { serverId: id, threadId: session, type: 'item', item: { ...item } });
      publish();
      try {
        const result = await this.shell(id, session, command);
        item.status = result.error ? 'Unconfirmed' : result.timedOut ? 'Timed out' : result.signal ? `Signal ${result.signal}`
          : result.exitCode === null ? 'Exit unknown' : `Exit ${result.exitCode}`;
        item.text = [result.stdout, result.stderr && `Standard error:\n${result.stderr}`, result.error,
          result.timedOut && 'Stopped waiting after 60 seconds and requested termination. Check before running again.',
          result.truncated && 'Output truncated after 128,000 characters.'].filter(Boolean).join('\n') || 'No output.';
        publish();
        return { shell: result };
      } catch (error) {
        item.status = 'Unconfirmed'; item.text = `${(error as Error).message}. Check the command before running it again.`;
        publish(); throw error;
      }
    }
    return this.backend(id).input(id, session, text, turn, model, effort, images);
  }
  rename(id: string, session: string, name: string) { return this.backend(id).rename(id, session, name); }
  interrupt(id: string, session: string, turn: string) { return this.backend(id).interrupt(id, session, turn); }
  answer(id: string, session: string, request: string, value: unknown) { return this.backend(id).answer(id, session, request, value); }
  file(id: string, session: string, path: string) { return this.backend(id).file(id, session, path); }
  shell(id: string, session: string, command: string) { return this.backend(id).shell(id, session, command); }
  close() { this.owners.clear(); for (const { backend } of this.registrations) backend.close(); }
}
