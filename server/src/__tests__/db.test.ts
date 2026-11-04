import { expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, publicServer } from '../db.js';

it('keeps server credentials private and ignores unexpected update fields', () => {
  const db = createDb(':memory:');
  try {
    const server = db.createServer({ name: 'Test', host: 'localhost', port: 22, username: 'user', authType: 'password', password: 'secret' });
    expect(publicServer(server)).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(publicServer(server))).not.toContain('secret');
    db.updateServer(server.id, { name: 'Updated', id: 'another-id' });
    expect(db.getServer(server.id)?.name).toBe('Updated');
    db.deleteServer(server.id); expect(db.listServers()).toEqual([]);
  } finally { db.close(); }
});

it('migrates server settings once and preserves legacy history when a connection is removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-db-'));
  const file = join(dir, 'gate.db');
  try {
    const old = new BetterSqlite3(file);
    old.exec(`CREATE TABLE servers (id TEXT PRIMARY KEY, name TEXT, host TEXT, port INTEGER, username TEXT,
      authType TEXT, password TEXT, privateKeyPath TEXT, createdAt INTEGER);
      INSERT INTO servers VALUES ('existing', 'Original', 'localhost', 22, 'user', 'password', 'secret', NULL, 1);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, serverId TEXT REFERENCES servers(id));
      INSERT INTO sessions VALUES ('history', 'existing');`);
    old.close();
    const db = createDb(file);
    expect(db.getServer('existing')).toMatchObject({ name: 'Original', password: 'secret' });
    db.deleteServer('existing'); db.close();
    const reopened = createDb(file);
    expect(reopened.listServers()).toEqual([]); reopened.close();
    const archive = new BetterSqlite3(file, { readonly: true });
    expect(archive.prepare('SELECT * FROM sessions').all()).toEqual([{ id: 'history', serverId: 'existing' }]);
    expect(archive.prepare('PRAGMA foreign_key_check').all()).toEqual([]); archive.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
