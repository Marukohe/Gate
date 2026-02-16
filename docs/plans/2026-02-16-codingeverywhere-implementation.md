# CodingEverywhere Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a responsive web app for chatting with Claude Code CLI on remote servers via SSH + tmux, from any device.

**Architecture:** React frontend communicates with Node.js backend over WebSocket. Backend manages SSH connections to remote servers, attaches to tmux sessions running Claude Code, parses terminal output into structured messages, and streams them to the browser.

**Tech Stack:** Vite + React + TypeScript + Tailwind CSS + shadcn/ui, Express + ws + ssh2 + better-sqlite3, Vitest for testing, zustand for state management.

---

### Task 1: Initialize Monorepo Structure

**Files:**
- Create: `package.json` (root workspace)
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `client/` (via Vite scaffolding)

**Step 1: Create root package.json with workspaces**

```json
{
  "name": "codingeverywhere",
  "private": true,
  "workspaces": ["client", "server"],
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "npm run dev --workspace=server",
    "dev:client": "npm run dev --workspace=client"
  }
}
```

**Step 2: Scaffold client with Vite**

Run: `npm create vite@latest client -- --template react-ts`

**Step 3: Create server/package.json**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "test": "vitest"
  }
}
```

**Step 4: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Install root dependencies**

Run: `npm install -D concurrently`

**Step 6: Install server dependencies**

Run: `cd server && npm install express ws ssh2 better-sqlite3 strip-ansi uuid && npm install -D typescript tsx vitest @types/express @types/ws @types/ssh2 @types/better-sqlite3 @types/uuid`

**Step 7: Create server entry point stub**

Create `server/src/index.ts`:

```typescript
import express from 'express';

const app = express();
const PORT = 3001;

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

**Step 8: Verify server starts**

Run: `cd server && npx tsx src/index.ts`
Expected: "Server running on http://localhost:3001"

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: initialize monorepo with client and server workspaces"
```

---

### Task 2: Setup Tailwind CSS + shadcn/ui in Client

**Files:**
- Modify: `client/package.json`
- Modify: `client/vite.config.ts`
- Create: `client/components.json` (shadcn/ui config)
- Modify: `client/src/index.css`
- Modify: `client/tailwind.config.ts`

**Step 1: Install Tailwind CSS in client**

Run: `cd client && npm install -D tailwindcss @tailwindcss/vite`

**Step 2: Configure Vite to use Tailwind**

Update `client/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true }
    }
  }
})
```

**Step 3: Update client/src/index.css with Tailwind import**

```css
@import "tailwindcss";
```

**Step 4: Initialize shadcn/ui**

Run: `cd client && npx shadcn@latest init`

Select: New York style, Zinc color, CSS variables: yes.

**Step 5: Install commonly used shadcn/ui components**

Run: `cd client && npx shadcn@latest add button input dialog sheet scroll-area separator tabs textarea badge collapsible checkbox tooltip`

**Step 6: Verify client starts with Tailwind working**

Run: `cd client && npm run dev`

Update `client/src/App.tsx` temporarily to verify:

```tsx
function App() {
  return (
    <div className="flex h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">CodingEverywhere</h1>
    </div>
  )
}

export default App
```

Expected: Centered heading with Tailwind styles in browser.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: setup Tailwind CSS and shadcn/ui in client"
```

---

### Task 3: Backend Database Layer

**Files:**
- Create: `server/src/db.ts`
- Create: `server/src/db.test.ts`

**Step 1: Write failing tests for database**

Create `server/src/db.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/db.test.ts`
Expected: FAIL — module `./db.js` not found

**Step 3: Implement database module**

Create `server/src/db.ts`:

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/db.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/src/db.ts server/src/db.test.ts
git commit -m "feat: add SQLite database layer with server, session, message CRUD"
```

---

### Task 4: Backend REST API for Server Management

**Files:**
- Create: `server/src/routes/servers.ts`
- Modify: `server/src/index.ts`

**Step 1: Create server routes**

Create `server/src/routes/servers.ts`:

```typescript
import { Router } from 'express';
import type { Database } from '../db.js';

export function createServerRoutes(db: Database): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(db.listServers());
  });

  router.get('/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    res.json(server);
  });

  router.post('/', (req, res) => {
    const { name, host, port, username, authType, password, privateKeyPath } = req.body;
    if (!name || !host || !username || !authType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const server = db.createServer({ name, host, port: port ?? 22, username, authType, password, privateKeyPath });
    res.status(201).json(server);
  });

  router.put('/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    db.updateServer(req.params.id, req.body);
    res.json(db.getServer(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    db.deleteServer(req.params.id);
    res.status(204).end();
  });

  router.get('/:id/sessions', (req, res) => {
    res.json(db.listSessions(req.params.id));
  });

  return router;
}
```

**Step 2: Update server entry point**

Update `server/src/index.ts`:

```typescript
import express from 'express';
import { createDb } from './db.js';
import { createServerRoutes } from './routes/servers.js';

const app = express();
const PORT = 3001;

app.use(express.json());

const db = createDb('./data/codingeverywhere.db');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/servers', createServerRoutes(db));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

**Step 3: Create data directory**

Run: `mkdir -p server/data && echo "*.db" > server/data/.gitignore`

**Step 4: Test manually with curl**

Run: `cd server && npx tsx src/index.ts &`

Then:
```bash
curl -X POST http://localhost:3001/api/servers \
  -H "Content-Type: application/json" \
  -d '{"name":"test","host":"10.0.0.1","username":"root","authType":"password","password":"123"}'
```

Expected: 201 with JSON server object

```bash
curl http://localhost:3001/api/servers
```

Expected: Array with 1 server

**Step 5: Commit**

```bash
git add server/src/routes/servers.ts server/src/index.ts server/data/.gitignore
git commit -m "feat: add REST API for server CRUD"
```

---

### Task 5: Terminal Output Parser

**Files:**
- Create: `server/src/parser.ts`
- Create: `server/src/parser.test.ts`

**Step 1: Write failing tests for parser**

Create `server/src/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ClaudeOutputParser } from './parser.js';

describe('ClaudeOutputParser', () => {
  it('should parse a simple assistant text message', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('Hello! I can help you with that.\n\n');
    parser.flush();

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some(m => m.type === 'assistant' && m.content.includes('Hello'))).toBe(true);
  });

  it('should strip ANSI escape codes', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('\x1b[1m\x1b[34mHello World\x1b[0m\n\n');
    parser.flush();

    expect(messages.some(m => m.content.includes('Hello World') && !m.content.includes('\x1b'))).toBe(true);
  });

  it('should detect tool call blocks', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('I\'ll edit that file for you.\n\n');
    parser.feed('⏺ Edit file: src/index.ts\n');
    parser.feed('  Added line: console.log("hello")\n\n');
    parser.flush();

    expect(messages.some(m => m.type === 'tool_call')).toBe(true);
  });

  it('should detect user prompt', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('> fix the bug in auth.ts\n');
    parser.flush();

    expect(messages.some(m => m.type === 'user')).toBe(true);
  });

  it('should handle Bash tool calls', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('⏺ Bash: npm test\n');
    parser.feed('  PASS src/test.ts\n');
    parser.feed('  Tests: 3 passed\n\n');
    parser.flush();

    const toolMsg = messages.find(m => m.type === 'tool_call');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.toolName).toBe('Bash');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/parser.test.ts`
Expected: FAIL — module `./parser.js` not found

**Step 3: Implement the parser**

Create `server/src/parser.ts`:

```typescript
import stripAnsi from 'strip-ansi';

export interface ParsedMessage {
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

type MessageCallback = (message: ParsedMessage) => void;

type ParserState = 'idle' | 'assistant' | 'user' | 'tool_call';

const TOOL_PATTERN = /^⏺\s+(Edit|Bash|Write|Read|Glob|Grep|Search|TodoWrite|Task|WebFetch|WebSearch)(?:[:\s](.*))?$/;
const USER_PROMPT_PATTERN = /^>\s+(.+)$/;

export class ClaudeOutputParser {
  private buffer = '';
  private state: ParserState = 'idle';
  private currentContent = '';
  private currentToolName = '';
  private currentToolDetail = '';
  private callbacks: MessageCallback[] = [];

  onMessage(callback: MessageCallback): void {
    this.callbacks.push(callback);
  }

  feed(data: string): void {
    const clean = stripAnsi(data);
    this.buffer += clean;

    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      this.processLine(line);
    }
  }

  flush(): void {
    if (this.buffer) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
    this.emitCurrent();
  }

  private processLine(line: string): void {
    const trimmed = line.trimEnd();

    // Check for user prompt
    const userMatch = trimmed.match(USER_PROMPT_PATTERN);
    if (userMatch) {
      this.emitCurrent();
      this.emit({
        type: 'user',
        content: userMatch[1],
        timestamp: Date.now(),
      });
      return;
    }

    // Check for tool call
    const toolMatch = trimmed.match(TOOL_PATTERN);
    if (toolMatch) {
      this.emitCurrent();
      this.state = 'tool_call';
      this.currentToolName = toolMatch[1];
      this.currentToolDetail = toolMatch[2]?.trim() ?? '';
      this.currentContent = '';
      return;
    }

    // Inside tool call block — indented lines are tool detail
    if (this.state === 'tool_call') {
      if (trimmed === '' && this.currentContent) {
        // Empty line may signal end of tool block
        this.emitCurrent();
        return;
      }
      if (line.startsWith('  ') || trimmed === '') {
        this.currentContent += (this.currentContent ? '\n' : '') + trimmed;
        return;
      }
      // Non-indented, non-empty line means tool block ended
      this.emitCurrent();
    }

    // Regular assistant text
    if (trimmed === '' && this.state === 'assistant' && this.currentContent) {
      // Double newline might signal end of block, but be lenient
      this.currentContent += '\n';
      return;
    }

    if (trimmed !== '' || this.state === 'assistant') {
      if (this.state !== 'assistant') {
        this.emitCurrent();
        this.state = 'assistant';
        this.currentContent = '';
      }
      this.currentContent += (this.currentContent ? '\n' : '') + trimmed;
    }
  }

  private emitCurrent(): void {
    if (this.state === 'assistant' && this.currentContent.trim()) {
      this.emit({
        type: 'assistant',
        content: this.currentContent.trim(),
        timestamp: Date.now(),
      });
    } else if (this.state === 'tool_call') {
      this.emit({
        type: 'tool_call',
        content: this.currentContent.trim(),
        toolName: this.currentToolName,
        toolDetail: this.currentToolDetail,
        timestamp: Date.now(),
      });
    }
    this.state = 'idle';
    this.currentContent = '';
    this.currentToolName = '';
    this.currentToolDetail = '';
  }

  private emit(message: ParsedMessage): void {
    for (const cb of this.callbacks) {
      cb(message);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run src/parser.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/src/parser.ts server/src/parser.test.ts
git commit -m "feat: add Claude Code terminal output parser with tests"
```

---

### Task 6: SSH Manager

**Files:**
- Create: `server/src/ssh-manager.ts`

**Step 1: Implement SSHManager**

Create `server/src/ssh-manager.ts`:

```typescript
import { Client, type ConnectConfig } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';

export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
}

interface SSHConnection {
  client: Client;
  channel: ClientChannel | null;
  tmuxSession: string | null;
}

export class SSHManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();

  async connect(config: ServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        this.connections.set(config.id, { client, channel: null, tmuxSession: null });
        this.emit('status', config.id, 'connected');
        resolve();
      });

      client.on('error', (err) => {
        this.emit('status', config.id, 'error', err.message);
        reject(err);
      });

      client.on('close', () => {
        this.connections.delete(config.id);
        this.emit('status', config.id, 'disconnected');
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
      };

      if (config.authType === 'password') {
        connectConfig.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKeyPath) {
        const fs = require('fs');
        connectConfig.privateKey = fs.readFileSync(config.privateKeyPath);
      }

      client.connect(connectConfig);
    });
  }

  async attachTmux(serverId: string, sessionName: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    return new Promise((resolve, reject) => {
      conn.client.shell({ term: 'xterm-256color' }, (err, channel) => {
        if (err) return reject(err);

        conn.channel = channel;
        conn.tmuxSession = sessionName;

        channel.on('data', (data: Buffer) => {
          this.emit('data', serverId, data.toString());
        });

        channel.on('close', () => {
          conn.channel = null;
          this.emit('status', serverId, 'disconnected');
        });

        // Try attach first, create if not exists
        channel.write(`tmux attach -t ${sessionName} 2>/dev/null || tmux new -s ${sessionName}\n`);

        // Give tmux a moment to initialize
        setTimeout(resolve, 500);
      });
    });
  }

  sendInput(serverId: string, text: string): void {
    const conn = this.connections.get(serverId);
    if (!conn?.channel) throw new Error(`No active channel for server ${serverId}`);
    conn.channel.write(text);
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    if (conn.channel) {
      conn.channel.end();
    }
    conn.client.end();
    this.connections.delete(serverId);
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  getActiveSession(serverId: string): string | null {
    return this.connections.get(serverId)?.tmuxSession ?? null;
  }
}
```

**Step 2: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add server/src/ssh-manager.ts
git commit -m "feat: add SSH manager with tmux session support"
```

---

### Task 7: WebSocket Handler

**Files:**
- Create: `server/src/ws-handler.ts`
- Modify: `server/src/index.ts`

**Step 1: Create WebSocket handler**

Create `server/src/ws-handler.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import { ClaudeOutputParser } from './parser.js';
import type { Database } from './db.js';

interface ClientMessage {
  type: 'connect' | 'input' | 'disconnect';
  serverId: string;
  text?: string;
  tmuxSession?: string;
}

interface ServerMessage {
  type: 'message' | 'status' | 'history';
  serverId: string;
  [key: string]: any;
}

export function setupWebSocket(httpServer: HttpServer, db: Database): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sshManager = new SSHManager();
  const parsers = new Map<string, ClaudeOutputParser>();

  sshManager.on('status', (serverId: string, status: string, error?: string) => {
    broadcast(wss, { type: 'status', serverId, status, error });
  });

  sshManager.on('data', (serverId: string, data: string) => {
    let parser = parsers.get(serverId);
    if (!parser) {
      parser = new ClaudeOutputParser();
      parsers.set(serverId, parser);

      parser.onMessage((message) => {
        broadcast(wss, { type: 'message', serverId, message });

        // Find active session and save message
        const sessions = db.listSessions(serverId);
        if (sessions.length > 0) {
          db.saveMessage({
            sessionId: sessions[0].id,
            ...message,
          });
          db.updateSessionActivity(sessions[0].id);
        }
      });
    }
    parser.feed(data);
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      try {
        switch (msg.type) {
          case 'connect': {
            const server = db.getServer(msg.serverId);
            if (!server) {
              ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, status: 'error', error: 'Server not found' }));
              return;
            }

            const config: ServerConfig = {
              id: server.id,
              host: server.host,
              port: server.port,
              username: server.username,
              authType: server.authType as 'password' | 'privateKey',
              password: server.password ?? undefined,
              privateKeyPath: server.privateKeyPath ?? undefined,
            };

            await sshManager.connect(config);

            const tmuxSession = msg.tmuxSession ?? 'claude-main';
            await sshManager.attachTmux(server.id, tmuxSession);

            // Create or reuse session
            const sessions = db.listSessions(server.id);
            const existing = sessions.find(s => s.tmuxSession === tmuxSession);
            if (!existing) {
              db.createSession(server.id, tmuxSession);
            }

            // Send history
            if (existing) {
              const messages = db.getMessages(existing.id);
              ws.send(JSON.stringify({ type: 'history', serverId: server.id, messages }));
            }
            break;
          }

          case 'input': {
            if (!msg.text) return;
            sshManager.sendInput(msg.serverId, msg.text + '\n');
            break;
          }

          case 'disconnect': {
            const parser = parsers.get(msg.serverId);
            if (parser) parser.flush();
            parsers.delete(msg.serverId);
            await sshManager.disconnect(msg.serverId);
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, status: 'error', error: err.message }));
      }
    });
  });
}

function broadcast(wss: WebSocketServer, data: ServerMessage): void {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}
```

**Step 2: Update server entry point to use WebSocket**

Update `server/src/index.ts`:

```typescript
import express from 'express';
import { createServer } from 'http';
import { createDb } from './db.js';
import { createServerRoutes } from './routes/servers.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();
const PORT = 3001;

app.use(express.json());

const db = createDb('./data/codingeverywhere.db');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/servers', createServerRoutes(db));

const httpServer = createServer(app);

setupWebSocket(httpServer, db);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

**Step 3: Verify server starts without errors**

Run: `cd server && npx tsx src/index.ts`
Expected: "Server running on http://localhost:3001" with no errors

**Step 4: Commit**

```bash
git add server/src/ws-handler.ts server/src/index.ts
git commit -m "feat: add WebSocket handler bridging frontend to SSH sessions"
```

---

### Task 8: Frontend State Management (Zustand Stores)

**Files:**
- Create: `client/src/stores/server-store.ts`
- Create: `client/src/stores/chat-store.ts`
- Create: `client/src/stores/plan-store.ts`
- Create: `client/src/stores/ui-store.ts`

**Step 1: Install zustand**

Run: `cd client && npm install zustand`

**Step 2: Create server store**

Create `client/src/stores/server-store.ts`:

```typescript
import { create } from 'zustand';

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

interface ServerStore {
  servers: Server[];
  activeServerId: string | null;
  connectionStatus: Record<string, 'connected' | 'disconnected' | 'connecting' | 'error'>;
  setServers: (servers: Server[]) => void;
  addServer: (server: Server) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string | null) => void;
  setConnectionStatus: (serverId: string, status: 'connected' | 'disconnected' | 'connecting' | 'error') => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: [],
  activeServerId: null,
  connectionStatus: {},
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  removeServer: (id) => set((s) => ({
    servers: s.servers.filter((sv) => sv.id !== id),
    activeServerId: s.activeServerId === id ? null : s.activeServerId,
  })),
  setActiveServer: (id) => set({ activeServerId: id }),
  setConnectionStatus: (serverId, status) => set((s) => ({
    connectionStatus: { ...s.connectionStatus, [serverId]: status },
  })),
}));
```

**Step 3: Create chat store**

Create `client/src/stores/chat-store.ts`:

```typescript
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

interface ChatStore {
  messages: Record<string, ChatMessage[]>; // keyed by serverId
  addMessage: (serverId: string, message: ChatMessage) => void;
  setHistory: (serverId: string, messages: ChatMessage[]) => void;
  clearMessages: (serverId: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: {},
  addMessage: (serverId, message) => set((s) => ({
    messages: {
      ...s.messages,
      [serverId]: [...(s.messages[serverId] ?? []), message],
    },
  })),
  setHistory: (serverId, messages) => set((s) => ({
    messages: { ...s.messages, [serverId]: messages },
  })),
  clearMessages: (serverId) => set((s) => ({
    messages: { ...s.messages, [serverId]: [] },
  })),
}));
```

**Step 4: Create plan store**

Create `client/src/stores/plan-store.ts`:

```typescript
import { create } from 'zustand';

export interface PlanStep {
  id: string;
  text: string;
  completed: boolean;
  children?: PlanStep[];
}

export interface Plan {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  steps: PlanStep[];
  status: 'draft' | 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
}

interface PlanStore {
  plans: Record<string, Plan[]>; // keyed by serverId
  activePlanId: string | null;
  addPlan: (serverId: string, plan: Plan) => void;
  updatePlan: (serverId: string, planId: string, updates: Partial<Plan>) => void;
  toggleStep: (serverId: string, planId: string, stepId: string) => void;
  setActivePlan: (planId: string | null) => void;
}

function toggleStepInList(steps: PlanStep[], stepId: string): PlanStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return { ...step, completed: !step.completed };
    if (step.children) return { ...step, children: toggleStepInList(step.children, stepId) };
    return step;
  });
}

export const usePlanStore = create<PlanStore>((set) => ({
  plans: {},
  activePlanId: null,
  addPlan: (serverId, plan) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: [...(s.plans[serverId] ?? []), plan],
    },
  })),
  updatePlan: (serverId, planId, updates) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: (s.plans[serverId] ?? []).map((p) =>
        p.id === planId ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    },
  })),
  toggleStep: (serverId, planId, stepId) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: (s.plans[serverId] ?? []).map((p) =>
        p.id === planId ? { ...p, steps: toggleStepInList(p.steps, stepId), updatedAt: Date.now() } : p
      ),
    },
  })),
  setActivePlan: (planId) => set({ activePlanId: planId }),
}));
```

**Step 5: Create UI store**

Create `client/src/stores/ui-store.ts`:

```typescript
import { create } from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  planPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePlanPanel: () => void;
  setPlanPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  planPanelOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  togglePlanPanel: () => set((s) => ({ planPanelOpen: !s.planPanelOpen })),
  setPlanPanelOpen: (open) => set({ planPanelOpen: open }),
}));
```

**Step 6: Commit**

```bash
git add client/src/stores/
git commit -m "feat: add zustand stores for servers, chat, plans, and UI state"
```

---

### Task 9: Frontend WebSocket Hook

**Files:**
- Create: `client/src/hooks/use-websocket.ts`

**Step 1: Create the WebSocket hook**

Create `client/src/hooks/use-websocket.ts`:

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { useServerStore } from '../stores/server-store';
import { useChatStore } from '../stores/chat-store';

let ws: WebSocket | null = null;

function getOrCreateWs(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  return ws;
}

export function useWebSocket() {
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const setHistory = useChatStore((s) => s.setHistory);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = getOrCreateWs();
    wsRef.current = socket;

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message':
          addMessage(data.serverId, {
            id: crypto.randomUUID(),
            ...data.message,
          });
          break;
        case 'status':
          setConnectionStatus(data.serverId, data.status);
          break;
        case 'history':
          setHistory(data.serverId, data.messages);
          break;
      }
    };

    socket.onclose = () => {
      ws = null;
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current === socket) {
          wsRef.current = getOrCreateWs();
        }
      }, 3000);
    };

    return () => {
      // Don't close on unmount — keep the connection alive
    };
  }, [addMessage, setConnectionStatus, setHistory]);

  const connectToServer = useCallback((serverId: string, tmuxSession?: string) => {
    const socket = getOrCreateWs();
    setConnectionStatus(serverId, 'connecting');
    socket.send(JSON.stringify({ type: 'connect', serverId, tmuxSession }));
  }, [setConnectionStatus]);

  const sendInput = useCallback((serverId: string, text: string) => {
    const socket = getOrCreateWs();
    socket.send(JSON.stringify({ type: 'input', serverId, text }));
  }, []);

  const disconnectFromServer = useCallback((serverId: string) => {
    const socket = getOrCreateWs();
    socket.send(JSON.stringify({ type: 'disconnect', serverId }));
  }, []);

  return { connectToServer, sendInput, disconnectFromServer };
}
```

**Step 2: Commit**

```bash
git add client/src/hooks/use-websocket.ts
git commit -m "feat: add WebSocket hook for real-time server communication"
```

---

### Task 10: Frontend App Shell (Responsive Layout)

**Files:**
- Create: `client/src/components/layout/AppShell.tsx`
- Create: `client/src/components/layout/Sidebar.tsx`
- Create: `client/src/components/layout/TopBar.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Install additional dependencies**

Run: `cd client && npm install react-markdown remark-gfm react-syntax-highlighter lucide-react && npm install -D @types/react-syntax-highlighter`

**Step 2: Create Sidebar component**

Create `client/src/components/layout/Sidebar.tsx`:

```tsx
import { Server, Plus, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useServerStore } from '@/stores/server-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onAddServer: () => void;
}

export function Sidebar({ onAddServer }: SidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const statusColor = (id: string) => {
    const status = connectionStatus[id];
    if (status === 'connected') return 'text-green-500';
    if (status === 'connecting') return 'text-yellow-500';
    if (status === 'error') return 'text-red-500';
    return 'text-muted-foreground';
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full w-16 flex-col items-center gap-2 border-r bg-muted/40 py-4">
        {servers.map((server) => (
          <Tooltip key={server.id}>
            <TooltipTrigger asChild>
              <Button
                variant={activeServerId === server.id ? 'secondary' : 'ghost'}
                size="icon"
                className={cn('relative h-10 w-10')}
                onClick={() => setActiveServer(server.id)}
              >
                <Server className="h-5 w-5" />
                <Circle className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 fill-current', statusColor(server.id))} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{server.name}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={onAddServer}>
              <Plus className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Add server</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
```

**Step 3: Create TopBar for mobile**

Create `client/src/components/layout/TopBar.tsx`:

```tsx
import { Menu, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore } from '@/stores/server-store';

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const togglePlanPanel = useUIStore((s) => s.togglePlanPanel);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);

  return (
    <div className="flex h-12 items-center justify-between border-b px-4 lg:hidden">
      <Button variant="ghost" size="icon" onClick={toggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>
      <span className="text-sm font-medium">{activeServer?.name ?? 'CodingEverywhere'}</span>
      <Button variant="ghost" size="icon" onClick={togglePlanPanel}>
        <FileText className="h-5 w-5" />
      </Button>
    </div>
  );
}
```

**Step 4: Create AppShell layout**

Create `client/src/components/layout/AppShell.tsx`:

```tsx
import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useUIStore } from '@/stores/ui-store';

interface AppShellProps {
  chatView: ReactNode;
  planPanel: ReactNode;
  onAddServer: () => void;
}

export function AppShell({ chatView, planPanel, onAddServer }: AppShellProps) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);
  const setPlanPanelOpen = useUIStore((s) => s.setPlanPanelOpen);

  return (
    <div className="flex h-dvh">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar onAddServer={onAddServer} />
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 p-0 lg:hidden">
          <Sidebar onAddServer={onAddServer} />
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          {/* Chat view */}
          <div className="flex-1 overflow-hidden">
            {chatView}
          </div>

          {/* Desktop plan panel */}
          <div className="hidden w-80 border-l lg:block">
            {planPanel}
          </div>
        </div>
      </div>

      {/* Mobile plan panel drawer */}
      <Sheet open={planPanelOpen} onOpenChange={setPlanPanelOpen}>
        <SheetContent side="right" className="w-full p-0 sm:w-96 lg:hidden">
          {planPanel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

**Step 5: Update App.tsx**

Update `client/src/App.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);

  useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then(setServers)
      .catch(console.error);
  }, [setServers]);

  return (
    <AppShell
      chatView={<div className="flex h-full items-center justify-center text-muted-foreground">Select a server to start</div>}
      planPanel={<div className="flex h-full items-center justify-center text-muted-foreground p-4">No active plan</div>}
      onAddServer={() => setServerDialogOpen(true)}
    />
  );
}

export default App;
```

**Step 6: Verify the layout renders**

Run: `cd client && npm run dev`
Expected: Three-column layout on desktop, mobile-responsive with hamburger/plan buttons

**Step 7: Commit**

```bash
git add client/src/components/layout/ client/src/App.tsx
git commit -m "feat: add responsive app shell with sidebar, topbar, and plan panel slots"
```

---

### Task 11: Server Management Dialog

**Files:**
- Create: `client/src/components/server/ServerDialog.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Create ServerDialog**

Create `client/src/components/server/ServerDialog.tsx`:

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useServerStore } from '@/stores/server-store';

interface ServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerDialog({ open, onOpenChange }: ServerDialogProps) {
  const addServer = useServerStore((s) => s.addServer);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');

  const handleSubmit = async () => {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, host, port: parseInt(port), username, authType,
        ...(authType === 'password' ? { password } : { privateKeyPath }),
      }),
    });
    if (res.ok) {
      const server = await res.json();
      addServer(server);
      onOpenChange(false);
      resetForm();
    }
  };

  const resetForm = () => {
    setName(''); setHost(''); setPort('22'); setUsername('');
    setPassword(''); setPrivateKeyPath('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Server</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Input placeholder="Name (e.g. dev-server)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Input placeholder="Host" className="flex-1" value={host} onChange={(e) => setHost(e.target.value)} />
            <Input placeholder="Port" className="w-20" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Tabs value={authType} onValueChange={(v) => setAuthType(v as 'password' | 'privateKey')}>
            <TabsList className="w-full">
              <TabsTrigger value="password" className="flex-1">Password</TabsTrigger>
              <TabsTrigger value="privateKey" className="flex-1">Private Key</TabsTrigger>
            </TabsList>
            <TabsContent value="password">
              <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </TabsContent>
            <TabsContent value="privateKey">
              <Input placeholder="Key path (e.g. ~/.ssh/id_rsa)" value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} />
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || !host || !username}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Wire into App.tsx**

Add import and render `<ServerDialog>` in `App.tsx`:

```tsx
import { ServerDialog } from '@/components/server/ServerDialog';

// Inside App component, add before closing tag:
// <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
```

**Step 3: Verify dialog works**

Run: `cd client && npm run dev`
Expected: Click "+" in sidebar → dialog opens → fill form → server appears in sidebar

**Step 4: Commit**

```bash
git add client/src/components/server/ServerDialog.tsx client/src/App.tsx
git commit -m "feat: add server management dialog"
```

---

### Task 12: Chat View — Message Rendering

**Files:**
- Create: `client/src/components/chat/ChatView.tsx`
- Create: `client/src/components/chat/MessageBubble.tsx`
- Create: `client/src/components/chat/ToolCallCard.tsx`
- Create: `client/src/components/chat/CodeBlock.tsx`
- Create: `client/src/components/chat/ChatInput.tsx`

**Step 1: Create CodeBlock component**

Create `client/src/components/chat/CodeBlock.tsx`:

```tsx
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-2 overflow-x-auto rounded-md">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <SyntaxHighlighter language={language ?? 'text'} style={oneDark} customStyle={{ margin: 0, fontSize: '0.85rem' }}>
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
```

**Step 2: Create ToolCallCard component**

Create `client/src/components/chat/ToolCallCard.tsx`:

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

interface ToolCallCardProps {
  message: ChatMessage;
}

export function ToolCallCard({ message }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 rounded-md border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        <Badge variant="outline" className="font-mono text-xs">{message.toolName}</Badge>
        <span className="truncate text-muted-foreground">{message.toolDetail || message.content.slice(0, 80)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <pre className="whitespace-pre-wrap text-xs">{message.content}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

**Step 3: Create MessageBubble component**

Create `client/src/components/chat/MessageBubble.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { ToolCallCard } from './ToolCallCard';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.type === 'tool_call' || message.type === 'tool_result') {
    return <ToolCallCard message={message} />;
  }

  if (message.type === 'system') {
    return (
      <div className="my-2 text-center text-xs text-muted-foreground">{message.content}</div>
    );
  }

  const isUser = message.type === 'user';

  return (
    <div className={cn('my-2 flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-lg px-4 py-2 text-sm',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted'
      )}>
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const code = String(children).replace(/\n$/, '');
                if (match) {
                  return <CodeBlock code={code} language={match[1]} />;
                }
                return <code className="rounded bg-background/50 px-1 py-0.5 text-xs" {...props}>{children}</code>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Create ChatInput component**

Create `client/src/components/chat/ChatInput.tsx`:

```tsx
import { useState, useRef, KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SendHorizontal } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t p-4">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          placeholder="Send a message to Claude..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="min-h-[44px] max-h-[200px] resize-none"
          rows={1}
        />
        <Button size="icon" onClick={handleSend} disabled={disabled || !value.trim()}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

**Step 5: Create ChatView container**

Create `client/src/components/chat/ChatView.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/chat-store';
import { useServerStore } from '@/stores/server-store';

interface ChatViewProps {
  onSend: (text: string) => void;
}

export function ChatView({ onSend }: ChatViewProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const messages = useChatStore((s) => activeServerId ? (s.messages[activeServerId] ?? []) : []);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isConnected = activeServerId ? connectionStatus[activeServerId] === 'connected' : false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeServerId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a server to start
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-4">
        <div className="mx-auto max-w-3xl py-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <ChatInput onSend={onSend} disabled={!isConnected} />
    </div>
  );
}
```

**Step 6: Commit**

```bash
git add client/src/components/chat/
git commit -m "feat: add chat view with message bubbles, code blocks, tool cards, and input"
```

---

### Task 13: Plan Panel

**Files:**
- Create: `client/src/components/plan/PlanPanel.tsx`
- Create: `client/src/components/plan/PlanStepItem.tsx`
- Create: `client/src/lib/plan-parser.ts`

**Step 1: Create plan markdown parser**

Create `client/src/lib/plan-parser.ts`:

```typescript
import type { PlanStep } from '@/stores/plan-store';

export function parseMarkdownChecklist(markdown: string): { title: string; steps: PlanStep[] } {
  const lines = markdown.split('\n');
  let title = '';
  const steps: PlanStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract title from first heading
    if (!title && trimmed.startsWith('#')) {
      title = trimmed.replace(/^#+\s*/, '');
      continue;
    }

    // Parse checklist items: - [ ] or - [x]
    const match = trimmed.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (match) {
      const indent = line.search(/\S/);
      const step: PlanStep = {
        id: crypto.randomUUID(),
        text: match[2],
        completed: match[1] !== ' ',
      };

      // Indent > 2 means it's a child of the last top-level step
      if (indent > 2 && steps.length > 0) {
        const parent = steps[steps.length - 1];
        parent.children = parent.children ?? [];
        parent.children.push(step);
      } else {
        steps.push(step);
      }
    }
  }

  return { title: title || 'Untitled Plan', steps };
}

export function stepsToMarkdown(title: string, steps: PlanStep[]): string {
  let md = `# ${title}\n\n`;
  for (const step of steps) {
    md += `- [${step.completed ? 'x' : ' '}] ${step.text}\n`;
    if (step.children) {
      for (const child of step.children) {
        md += `   - [${child.completed ? 'x' : ' '}] ${child.text}\n`;
      }
    }
  }
  return md;
}
```

**Step 2: Create PlanStepItem component**

Create `client/src/components/plan/PlanStepItem.tsx`:

```tsx
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { PlanStep } from '@/stores/plan-store';

interface PlanStepItemProps {
  step: PlanStep;
  onToggle: (stepId: string) => void;
}

export function PlanStepItem({ step, onToggle }: PlanStepItemProps) {
  return (
    <div>
      <div className="flex items-start gap-2 py-1">
        <Checkbox
          checked={step.completed}
          onCheckedChange={() => onToggle(step.id)}
          className="mt-0.5"
        />
        <span className={cn('text-sm', step.completed && 'text-muted-foreground line-through')}>
          {step.text}
        </span>
      </div>
      {step.children && step.children.length > 0 && (
        <div className="ml-6">
          {step.children.map((child) => (
            <PlanStepItem key={child.id} step={child} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create PlanPanel component**

Create `client/src/components/plan/PlanPanel.tsx`:

```tsx
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlanStepItem } from './PlanStepItem';
import { usePlanStore } from '@/stores/plan-store';
import { useServerStore } from '@/stores/server-store';
import { parseMarkdownChecklist, stepsToMarkdown } from '@/lib/plan-parser';

interface PlanPanelProps {
  onSendToChat: (text: string) => void;
}

export function PlanPanel({ onSendToChat }: PlanPanelProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const plans = usePlanStore((s) => activeServerId ? (s.plans[activeServerId] ?? []) : []);
  const activePlanId = usePlanStore((s) => s.activePlanId);
  const toggleStep = usePlanStore((s) => s.toggleStep);
  const updatePlan = usePlanStore((s) => s.updatePlan);

  const activePlan = plans.find((p) => p.id === activePlanId);
  const [editContent, setEditContent] = useState('');
  const [tab, setTab] = useState('view');

  const handleEditStart = () => {
    if (activePlan) {
      setEditContent(stepsToMarkdown(activePlan.title, activePlan.steps));
    }
    setTab('edit');
  };

  const handleSave = () => {
    if (!activePlan || !activeServerId) return;
    const { title, steps } = parseMarkdownChecklist(editContent);
    updatePlan(activeServerId, activePlan.id, { title, steps, content: editContent });
    setTab('view');
  };

  const handleSendToClaudeForExecution = () => {
    if (!activePlan) return;
    const md = stepsToMarkdown(activePlan.title, activePlan.steps);
    onSendToChat(`Please execute this plan:\n\n${md}`);
  };

  if (!activePlan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
        <p className="text-sm">No active plan</p>
        <p className="text-xs">Extract a plan from chat to get started</p>
      </div>
    );
  }

  const completedCount = activePlan.steps.filter((s) => s.completed).length;
  const totalCount = activePlan.steps.length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h3 className="font-semibold">{activePlan.title}</h3>
        <p className="text-xs text-muted-foreground">{completedCount}/{totalCount} steps completed</p>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="view" className="flex-1">View</TabsTrigger>
          <TabsTrigger value="edit" className="flex-1" onClick={handleEditStart}>Edit</TabsTrigger>
        </TabsList>
        <TabsContent value="view" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full px-4 pb-4">
            {activePlan.steps.map((step) => (
              <PlanStepItem
                key={step.id}
                step={step}
                onToggle={(stepId) => activeServerId && toggleStep(activeServerId, activePlan.id, stepId)}
              />
            ))}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="edit" className="flex flex-1 flex-col gap-2 p-4">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 resize-none font-mono text-xs"
          />
          <Button size="sm" onClick={handleSave}>Save</Button>
        </TabsContent>
      </Tabs>
      <div className="border-t p-4">
        <Button size="sm" variant="outline" className="w-full" onClick={handleSendToClaudeForExecution}>
          Send to Claude for execution
        </Button>
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add client/src/components/plan/ client/src/lib/plan-parser.ts
git commit -m "feat: add plan panel with view/edit modes and markdown checklist parser"
```

---

### Task 14: Wire Everything Together in App.tsx

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Update App.tsx to connect all components**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { ChatView } from '@/components/chat/ChatView';
import { PlanPanel } from '@/components/plan/PlanPanel';
import { ServerDialog } from '@/components/server/ServerDialog';
import { useServerStore } from '@/stores/server-store';
import { useChatStore } from '@/stores/chat-store';
import { usePlanStore } from '@/stores/plan-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { parseMarkdownChecklist } from '@/lib/plan-parser';

function App() {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const setServers = useServerStore((s) => s.setServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const addPlan = usePlanStore((s) => s.addPlan);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  const { connectToServer, sendInput } = useWebSocket();

  useEffect(() => {
    fetch('/api/servers')
      .then((r) => r.json())
      .then(setServers)
      .catch(console.error);
  }, [setServers]);

  // Auto-connect when selecting a server
  useEffect(() => {
    if (activeServerId && connectionStatus[activeServerId] !== 'connected' && connectionStatus[activeServerId] !== 'connecting') {
      connectToServer(activeServerId);
    }
  }, [activeServerId, connectionStatus, connectToServer]);

  const handleSend = useCallback((text: string) => {
    if (!activeServerId) return;

    // Add user message to local store
    addMessage(activeServerId, {
      id: crypto.randomUUID(),
      type: 'user',
      content: text,
      timestamp: Date.now(),
    });

    sendInput(activeServerId, text);
  }, [activeServerId, addMessage, sendInput]);

  const handleExtractPlan = useCallback((content: string) => {
    if (!activeServerId) return;
    const { title, steps } = parseMarkdownChecklist(content);
    const plan = {
      id: crypto.randomUUID(),
      sessionId: activeServerId,
      title,
      content,
      steps,
      status: 'active' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addPlan(activeServerId, plan);
    setActivePlan(plan.id);
  }, [activeServerId, addPlan, setActivePlan]);

  return (
    <>
      <AppShell
        chatView={<ChatView onSend={handleSend} />}
        planPanel={<PlanPanel onSendToChat={handleSend} />}
        onAddServer={() => setServerDialogOpen(true)}
      />
      <ServerDialog open={serverDialogOpen} onOpenChange={setServerDialogOpen} />
    </>
  );
}

export default App;
```

**Step 2: Verify the full app runs end-to-end**

Run both server and client:
```bash
cd /path/to/project && npm run dev
```

Expected: Full app loads, can add a server, select it, see connection attempt

**Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: wire all components together in App with auto-connect and plan extraction"
```

---

### Task 15: Extract Plan Button in Chat Messages

**Files:**
- Modify: `client/src/components/chat/MessageBubble.tsx`
- Modify: `client/src/components/chat/ChatView.tsx`

**Step 1: Add "Extract Plan" button to assistant messages containing checklists**

Update `MessageBubble.tsx` to accept an `onExtractPlan` prop:

```tsx
// Add to MessageBubble props:
onExtractPlan?: (content: string) => void;

// Add inside the assistant message bubble, after the ReactMarkdown:
{!isUser && message.content.includes('- [ ]') && onExtractPlan && (
  <Button
    variant="outline"
    size="sm"
    className="mt-2"
    onClick={() => onExtractPlan(message.content)}
  >
    Extract to Plan Panel
  </Button>
)}
```

**Step 2: Pass handler through ChatView**

Update `ChatView` to accept and pass `onExtractPlan` prop.

**Step 3: Commit**

```bash
git add client/src/components/chat/MessageBubble.tsx client/src/components/chat/ChatView.tsx
git commit -m "feat: add 'Extract to Plan Panel' button on assistant messages with checklists"
```

---

### Task 16: Final Polish and Dev Script

**Files:**
- Modify: `package.json` (root)
- Create: `.gitignore`

**Step 1: Create root .gitignore**

```
node_modules/
dist/
*.db
.env
```

**Step 2: Verify full dev workflow**

```bash
npm install
npm run dev
```

Expected: Both server (port 3001) and client (port 5173) start, Vite proxies API/WS to server.

**Step 3: Commit**

```bash
git add .gitignore package.json
git commit -m "chore: add gitignore and finalize dev scripts"
```
