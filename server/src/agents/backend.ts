import type { DirectoryListing, ModelOption, MonitorServer, Server, ServerEvent, Session, SessionDetail, ShellResult, ToolDefinition } from '../types.js';

// Each backend owns its tool's connections and translates its sessions, actions, and events into Gate types.
export interface AgentBackend {
  // Sync receives the complete set of connections owned by this adapter, including an empty set on removal.
  sync(servers: Server[]): void;
  monitor(): { servers: MonitorServer[] };
  detail(serverId: string, sessionId: string, cursor?: string): Promise<SessionDetail>;
  create(serverId: string, cwd: string): Promise<Session>;
  models(serverId: string, sessionId?: string): Promise<ModelOption[]>;
  input(serverId: string, sessionId: string, text: string, turnId?: string, model?: string, effort?: string, images?: unknown): Promise<unknown>;
  rename(serverId: string, sessionId: string, name: string): Promise<void>;
  interrupt(serverId: string, sessionId: string, turnId: string): Promise<unknown>;
  answer(serverId: string, sessionId: string, requestId: string, value: unknown): Promise<void>;
  directory(serverId: string, sessionId: string, path: string): Promise<DirectoryListing>;
  file(serverId: string, sessionId: string, path: string): Promise<{ path: string; data: Buffer }>;
  shell(serverId: string, sessionId: string, command: string): Promise<ShellResult>;
  on(event: 'event', listener: (event: ServerEvent) => void): unknown;
  close(): void;
}

// Registration supplies discovery metadata and a fresh backend for each Gate instance.
export interface AgentAdapter {
  readonly tool: ToolDefinition;
  createBackend(): AgentBackend;
}
