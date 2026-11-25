import { EventEmitter } from 'node:events';
import type { AgentBackend, BackendRegistration } from './agent-backend.js';
import type { Server, ServerEvent } from './types.js';

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
  input(id: string, session: string, text: string, turn?: string, model?: string, effort?: string, images?: unknown) {
    return this.backend(id).input(id, session, text, turn, model, effort, images);
  }
  rename(id: string, session: string, name: string) { return this.backend(id).rename(id, session, name); }
  interrupt(id: string, session: string, turn: string) { return this.backend(id).interrupt(id, session, turn); }
  answer(id: string, session: string, request: string, value: unknown) { return this.backend(id).answer(id, session, request, value); }
  file(id: string, session: string, path: string) { return this.backend(id).file(id, session, path); }
  shell(id: string, session: string, command: string) { return this.backend(id).shell(id, session, command); }
  close() { this.owners.clear(); for (const { backend } of this.registrations) backend.close(); }
}
