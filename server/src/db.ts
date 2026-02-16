import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  serverId: string;
  tmuxSession: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface Message {
  id: string;
  sessionId: string;
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

export type CreateServerInput = Omit<Server, 'id' | 'createdAt'>;
export type CreateMessageInput = Omit<Message, 'id'>;

export interface Database {
  createServer(input: CreateServerInput): Server;
  getServer(id: string): Server | undefined;
  listServers(): Server[];
  updateServer(id: string, updates: Partial<CreateServerInput>): void;
  deleteServer(id: string): void;
  createSession(serverId: string, tmuxSession: string): Session;
  listSessions(serverId: string): Session[];
  updateSessionActivity(id: string): void;
  saveMessage(input: CreateMessageInput): Message;
  getMessages(sessionId: string, limit?: number): Message[];
  close(): void;
}

export function createDb(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      authType TEXT NOT NULL,
      password TEXT,
      privateKeyPath TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      tmuxSession TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastActiveAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      toolName TEXT,
      toolDetail TEXT,
      timestamp INTEGER NOT NULL
    );
  `);

  return {
    createServer(input) {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, host, port, username, authType, password, privateKeyPath, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.host, input.port, input.username, input.authType, input.password ?? null, input.privateKeyPath ?? null, createdAt);
      return { id, ...input, createdAt };
    },

    getServer(id) {
      return db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as Server | undefined;
    },

    listServers() {
      return db.prepare('SELECT * FROM servers ORDER BY createdAt DESC').all() as Server[];
    },

    updateServer(id, updates) {
      const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
      if (fields.length === 0) return;
      const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
      const values = fields.map(([, v]) => v);
      db.prepare(`UPDATE servers SET ${setClauses} WHERE id = ?`).run(...values, id);
    },

    deleteServer(id) {
      db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    },

    createSession(serverId, tmuxSession) {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`
        INSERT INTO sessions (id, serverId, tmuxSession, createdAt, lastActiveAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, serverId, tmuxSession, now, now);
      return { id, serverId, tmuxSession, createdAt: now, lastActiveAt: now };
    },

    listSessions(serverId) {
      return db.prepare('SELECT * FROM sessions WHERE serverId = ? ORDER BY lastActiveAt DESC').all(serverId) as Session[];
    },

    updateSessionActivity(id) {
      db.prepare('UPDATE sessions SET lastActiveAt = ? WHERE id = ?').run(Date.now(), id);
    },

    saveMessage(input) {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO messages (id, sessionId, type, content, toolName, toolDetail, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.sessionId, input.type, input.content, input.toolName ?? null, input.toolDetail ?? null, input.timestamp);
      return { id, ...input };
    },

    getMessages(sessionId, limit = 200) {
      return db.prepare('SELECT * FROM messages WHERE sessionId = ? ORDER BY timestamp ASC LIMIT ?').all(sessionId, limit) as Message[];
    },

    close() {
      db.close();
    },
  };
}
