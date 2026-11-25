import type { ModelOption, MonitorServer, Server, ServerEvent, Session, SessionDetail, ShellResult, ToolDefinition } from './types.js';

// Backends translate native protocols into Gate data. HTTP and UI never issue native RPCs.
export interface AgentBackend {
  sync(servers: Server[]): void;
  monitor(): { servers: MonitorServer[] };
  detail(serverId: string, sessionId: string, cursor?: string): Promise<SessionDetail>;
  create(serverId: string, cwd: string): Promise<Session>;
  models(serverId: string, sessionId?: string): Promise<ModelOption[]>;
  input(serverId: string, sessionId: string, text: string, turnId?: string, model?: string, effort?: string, images?: unknown): Promise<unknown>;
  rename(serverId: string, sessionId: string, name: string): Promise<void>;
  interrupt(serverId: string, sessionId: string, turnId: string): Promise<unknown>;
  answer(serverId: string, sessionId: string, requestId: string, value: unknown): Promise<void>;
  file(serverId: string, sessionId: string, path: string): Promise<{ path: string; data: Buffer }>;
  shell(serverId: string, sessionId: string, command: string): Promise<ShellResult>;
  on(event: 'event', listener: (event: ServerEvent) => void): unknown;
  close(): void;
}

export interface BackendRegistration { tool: ToolDefinition; backend: AgentBackend }
