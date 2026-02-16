import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Database } from './db.js';
import fs from 'fs';

const TEST_DB = '/tmp/codingeverywhere-test.db';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('servers', () => {
    it('should create and list servers', () => {
      db.createServer({
        name: 'My Server',
        host: '192.168.1.100',
        port: 22,
        username: 'user',
        authType: 'password',
        password: 'pass123',
      });

      const servers = db.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('My Server');
      expect(servers[0].host).toBe('192.168.1.100');
    });

    it('should delete a server', () => {
      const server = db.createServer({
        name: 'ToDelete',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'privateKey',
        privateKeyPath: '/home/user/.ssh/id_rsa',
      });

      db.deleteServer(server.id);
      expect(db.listServers()).toHaveLength(0);
    });

    it('should update a server', () => {
      const server = db.createServer({
        name: 'Old Name',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'old',
      });

      db.updateServer(server.id, { name: 'New Name', password: 'new' });
      const updated = db.getServer(server.id);
      expect(updated?.name).toBe('New Name');
      expect(updated?.password).toBe('new');
    });
  });

  describe('sessions', () => {
    it('should create and list sessions for a server', () => {
      const server = db.createServer({
        name: 'S1',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'pass',
      });

      db.createSession(server.id, 'claude-main');
      const sessions = db.listSessions(server.id);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tmuxSession).toBe('claude-main');
    });
  });

  describe('messages', () => {
    it('should save and retrieve messages', () => {
      const server = db.createServer({
        name: 'S1',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        password: 'pass',
      });
      const session = db.createSession(server.id, 'claude-main');

      db.saveMessage({
        sessionId: session.id,
        type: 'assistant',
        content: 'Hello, how can I help?',
        timestamp: Date.now(),
      });

      const messages = db.getMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('assistant');
      expect(messages[0].content).toBe('Hello, how can I help?');
    });
  });
});
