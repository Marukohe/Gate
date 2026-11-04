export type SessionState = 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'stopped' | 'unknown';
export interface MonitoredSession {
  id: string; serverId: string; name: string; provider: string; cwd: string | null;
  source: 'chat' | 'managed' | 'external'; state: SessionState; activity: string; updatedAt: number;
  sessionId?: string; runId?: string; nativeSessionId?: string | null;
}
export interface MonitorSnapshot {
  capturedAt: number;
  servers: { id: string; name: string; host: string; port: number; username: string; sessions: MonitoredSession[] }[];
}

