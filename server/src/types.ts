export interface Server {
  id: string; name: string; host: string; port: number; username: string;
  authType: 'password' | 'privateKey'; password?: string; privateKeyPath?: string;
  defaultWorkingDir?: string; tool?: string; executablePath?: string; codexPath?: string; createdAt: number;
  sshAccountId?: string;
}
export type PublicServer = Omit<Server, 'password'> & { hasPassword: boolean };
export interface SshHost { alias: string; host: string; port: number; username: string; identityFiles: string[] }
export interface ToolDefinition { id: string; name: string; executable: string; description: string }
export type SessionState = 'running' | 'waiting' | 'idle' | 'saved' | 'error' | 'unknown';
export interface Session {
  id: string; name: string; cwd: string; projectPath?: string; preview: string; updatedAt: number;
  state: SessionState; canInput: boolean;
  model?: string; effort?: string; attentionReason?: string;
}
export interface SessionCapabilities { rename: boolean; images: boolean; steer: boolean; models: boolean; effort: boolean; interrupt: boolean }
export interface ModelOption {
  id: string; name: string; efforts: { id: string; description: string }[]; defaultEffort?: string;
}
export interface MonitorServer {
  id: string; name: string; host: string; username: string;
  port?: number; createdAt?: number;
  state: 'connecting' | 'connected' | 'error'; error?: string; hasFilters?: boolean; sessions: Session[]; hasMore: boolean;
  tool?: string; toolName?: string; statusNote?: string;
}
export interface Item {
  id: string; kind: 'user' | 'assistant' | 'tool' | 'notice'; text: string; title?: string; status?: string;
  images?: string[];
}
export interface ShellResult {
  stdout: string; stderr: string; exitCode: number | null; signal?: string;
  timedOut: boolean; truncated: boolean; error?: string;
}
export interface DirectoryListing {
  cwd: string; path: string; truncated: boolean;
  entries: { name: string; kind: 'directory' | 'file' | 'other'; symlink: boolean; size: number }[];
}
export type FilePreview = { path: string; size: number } &
  ({ kind: 'text'; text: string } | { kind: 'image' | 'download' });
export interface Question { id: string; text: string; options: string[]; secret: boolean }
export interface Request {
  id: string; threadId: string; turnId?: string; method: string; title: string; detail: string;
  kind: 'approval' | 'question' | 'permissions' | 'unsupported'; choices: string[]; questions: Question[]; answering: boolean;
  choiceLabels?: Record<string, string>;
}
export interface SessionDetail {
  session: Session; items: Item[]; nextCursor: string | null; turnId: string | null; requests: Request[];
  capabilities?: SessionCapabilities; toolName?: string; statusNote?: string;
  // Changes when a backend without stable message IDs replays authoritative history after reconnecting.
  historyVersion?: string;
}
export interface ServerEvent {
  serverId: string; threadId?: string; type: 'changed' | 'item' | 'delta' | 'disconnected';
  item?: Item; itemId?: string; delta?: string;
}

export interface ArchivedSession { id: string; name: string; cwd: string; archivedAt: number }
export interface VisibilitySettings { excludedDirectories: string[]; archivedSessions: ArchivedSession[] }
export interface VisibilityOptions extends VisibilitySettings { directories: string[] }
