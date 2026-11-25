import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Server, PublicServer, VisibilitySettings, ArchivedSession } from './types.js';
export type { Server } from './types.js';
export const publicServer = ({ password, ...server }: Server): PublicServer => ({ ...server, hasPassword: !!password });
export type Database = ReturnType<typeof createDb>;

export function createDb(file: string) {
  const db = new BetterSqlite3(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = `CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER DEFAULT 22,
    username TEXT NOT NULL, authType TEXT NOT NULL, password TEXT, privateKeyPath TEXT,
    defaultWorkingDir TEXT, codexPath TEXT, createdAt INTEGER NOT NULL
  )`;
  db.exec(schema);
  const columns = db.prepare('PRAGMA table_info(servers)').all() as { name: string }[];
  for (const column of ['defaultWorkingDir', 'codexPath']) {
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE servers ADD COLUMN ${column} TEXT`);
  }
  if (!columns.some((c) => c.name === 'tool')) db.exec("ALTER TABLE servers ADD COLUMN tool TEXT NOT NULL DEFAULT 'codex'");
  if (!columns.some((c) => c.name === 'executablePath')) {
    db.exec('ALTER TABLE servers ADD COLUMN executablePath TEXT');
    db.exec("UPDATE servers SET executablePath = COALESCE(NULLIF(codexPath, ''), 'codex')");
  }
  const fields = ['name', 'host', 'port', 'username', 'authType', 'password', 'privateKeyPath', 'defaultWorkingDir', 'codexPath', 'tool', 'executablePath'] as const;
  const table = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (table('sessions') && !table('archived_servers')) {
    // Keep old foreign keys and history together; removing a connection must not erase the archive.
    db.transaction(() => {
      db.exec('ALTER TABLE servers RENAME TO archived_servers');
      db.exec(schema);
      db.exec("ALTER TABLE servers ADD COLUMN tool TEXT NOT NULL DEFAULT 'codex'");
      db.exec('ALTER TABLE servers ADD COLUMN executablePath TEXT');
      const names = ['id', ...fields, 'createdAt'].join(', ');
      db.exec(`INSERT INTO servers (${names}) SELECT ${names} FROM archived_servers`);
    })();
  }
  db.exec(`CREATE TABLE IF NOT EXISTS monitor_preferences (
    serverId TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    excludedDirectories TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS session_archives (
    serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    sessionId TEXT NOT NULL, name TEXT NOT NULL, cwd TEXT NOT NULL, archivedAt INTEGER NOT NULL,
    PRIMARY KEY (serverId, sessionId)
  )`);
  return {
    getVisibility(serverId: string): VisibilitySettings {
      const row = db.prepare('SELECT excludedDirectories FROM monitor_preferences WHERE serverId = ?').get(serverId) as
        { excludedDirectories: string } | undefined;
      return { excludedDirectories: row ? JSON.parse(row.excludedDirectories) : [],
        archivedSessions: db.prepare('SELECT sessionId AS id, name, cwd, archivedAt FROM session_archives WHERE serverId = ? ORDER BY archivedAt DESC')
          .all(serverId) as ArchivedSession[] };
    },
    setExcludedDirectories(serverId: string, directories: string[]) {
      db.prepare(`INSERT INTO monitor_preferences (serverId, excludedDirectories) VALUES (?, ?)
        ON CONFLICT(serverId) DO UPDATE SET excludedDirectories = excluded.excludedDirectories`).run(serverId, JSON.stringify(directories));
    },
    archiveSession(serverId: string, session: Pick<ArchivedSession, 'id' | 'name' | 'cwd'>) {
      db.prepare(`INSERT INTO session_archives (serverId, sessionId, name, cwd, archivedAt) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(serverId, sessionId) DO NOTHING`).run(serverId, session.id, session.name, session.cwd, Date.now());
    },
    restoreSession(serverId: string, id: string) {
      db.prepare('DELETE FROM session_archives WHERE serverId = ? AND sessionId = ?').run(serverId, id);
    },
    listServers: () => db.prepare('SELECT * FROM servers ORDER BY createdAt DESC').all() as Server[],
    getServer: (id: string) => db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as Server | undefined,
    createServer(input: Omit<Server, 'id' | 'createdAt'>): Server {
      const server = { ...input, tool: input.tool || 'codex', executablePath: input.executablePath || input.codexPath,
        id: randomUUID(), createdAt: Date.now() };
      db.prepare(`INSERT INTO servers (id, createdAt, ${fields.join(', ')}) VALUES (${Array(fields.length + 2).fill('?').join(', ')})`)
        .run(server.id, server.createdAt, ...fields.map((f) => server[f] ?? null));
      return server;
    },
    updateServer(id: string, input: Partial<Server>) {
      const changed = fields.filter((field) => input[field] !== undefined);
      if (changed.length) db.prepare(`UPDATE servers SET ${changed.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`)
        .run(...changed.map((field) => input[field] ?? null), id);
    },
    deleteServer: (id: string) => { db.prepare('DELETE FROM servers WHERE id = ?').run(id); },
    close: () => { db.close(); },
  };
}
