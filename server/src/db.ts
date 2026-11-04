import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Server, PublicServer } from './types.js';
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
  const fields = ['name', 'host', 'port', 'username', 'authType', 'password', 'privateKeyPath', 'defaultWorkingDir', 'codexPath'] as const;
  const table = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  if (table('sessions') && !table('archived_servers')) {
    // Keep old foreign keys and history together; removing a connection must not erase the archive.
    db.transaction(() => {
      db.exec('ALTER TABLE servers RENAME TO archived_servers');
      db.exec(schema);
      const names = ['id', ...fields, 'createdAt'].join(', ');
      db.exec(`INSERT INTO servers (${names}) SELECT ${names} FROM archived_servers`);
    })();
  }
  return {
    listServers: () => db.prepare('SELECT * FROM servers ORDER BY createdAt DESC').all() as Server[],
    getServer: (id: string) => db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as Server | undefined,
    createServer(input: Omit<Server, 'id' | 'createdAt'>): Server {
      const server = { ...input, id: randomUUID(), createdAt: Date.now() };
      db.prepare(`INSERT INTO servers (id, createdAt, ${fields.join(', ')}) VALUES (${Array(11).fill('?').join(', ')})`)
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
