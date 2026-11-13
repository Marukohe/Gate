export interface Server {
  id: string; name: string; host: string; port: number; username: string;
  authType: 'password' | 'privateKey'; password?: string; privateKeyPath?: string;
  defaultWorkingDir?: string; codexPath?: string; createdAt: number;
}
export type PublicServer = Omit<Server, 'password'> & { hasPassword: boolean };
export type SessionState = 'running' | 'waiting' | 'idle' | 'saved' | 'error' | 'unknown';
export interface Session {
  id: string; name: string; cwd: string; projectPath?: string; preview: string; updatedAt: number;
  state: SessionState; canInput: boolean;
  model?: string;
}
export interface ModelOption { id: string; name: string }
export interface MonitorServer {
  id: string; name: string; host: string; username: string;
  state: 'connecting' | 'connected' | 'error'; error?: string; hasFilters?: boolean; sessions: Session[]; hasMore: boolean;
}
export interface Item {
  id: string; kind: 'user' | 'assistant' | 'tool' | 'notice'; text: string; title?: string; status?: string;
}
export interface Question { id: string; text: string; options: string[]; secret: boolean }
export interface Request {
  id: string; threadId: string; turnId?: string; method: string; title: string; detail: string;
  kind: 'approval' | 'question' | 'permissions' | 'unsupported'; choices: string[]; questions: Question[]; answering: boolean;
}
export interface SessionDetail {
  session: Session; items: Item[]; nextCursor: string | null; turnId: string | null; requests: Request[];
}
export interface ServerEvent {
  serverId: string; threadId?: string; type: 'changed' | 'item' | 'delta' | 'disconnected';
  item?: Item; itemId?: string; delta?: string;
}

export interface ArchivedSession { id: string; name: string; cwd: string; archivedAt: number }
export interface VisibilitySettings { excludedDirectories: string[]; archivedSessions: ArchivedSession[] }
export interface VisibilityOptions extends VisibilitySettings { directories: string[] }
