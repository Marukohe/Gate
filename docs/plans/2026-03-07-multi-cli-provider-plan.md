# Multi-CLI Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Gate to support multiple CLI tools (Claude Code, Codex, future tools) via a provider abstraction layer, enabling tool switching within a single session with context compaction.

**Architecture:** Three-layer design — Web Client → Gate Server (Provider Abstraction) → CLI via SSH. Sessions bind to working directories, not CLI tools. Plan/Todo is a Gate-level feature independent of any CLI. Different providers' messages render with distinct bubble background colors.

**Tech Stack:** TypeScript, Vitest, ssh2, EventEmitter, Zustand

**Design Doc:** `docs/plans/2026-03-07-multi-cli-provider-design.md`

---

## Phase 1: Provider Abstraction Layer (Pure Refactor)

### Task 1: Define Provider Types

**Files:**
- Create: `server/src/providers/types.ts`
- Test: `server/src/__tests__/providers/types.test.ts`

**Step 1: Create the provider types file**

```typescript
// server/src/providers/types.ts
import { EventEmitter } from 'events';

export interface ParsedMessage {
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  subType?: string;
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
  provider?: string;
}

export interface RemoteSession {
  id: string;
  timestamp?: number;
  label?: string;
}

export interface ProviderCapabilities {
  nativePlanMode: boolean;
  nativeTodoTracking: boolean;
  supportsResume: boolean;
  supportsStdin: boolean;
}

export type SSHExec = (command: string) => Promise<{ stdout: string }>;

export abstract class OutputParser extends EventEmitter {
  abstract feed(chunk: string): void;
  abstract flush(): void;
  abstract getSessionId(): string | null;
}

export interface CLIProvider {
  readonly name: string;

  buildCommand(opts: {
    resumeSessionId?: string;
    workingDir?: string;
    initialContext?: string;
  }): string;

  formatInput(text: string): string;

  requestSummary(): string;

  createParser(): OutputParser;

  extractSessionId(event: ParsedMessage): string | null;

  normalizeToolName(rawName: string): string;

  listRemoteSessions(
    runCommand: SSHExec,
    workingDir: string,
  ): Promise<RemoteSession[]>;

  syncTranscript(
    runCommand: SSHExec,
    sessionId: string,
    workingDir?: string,
  ): Promise<ParsedMessage[]>;

  getCapabilities(): ProviderCapabilities;
}
```

**Step 2: Write a basic type validation test**

```typescript
// server/src/__tests__/providers/types.test.ts
import { describe, it, expect } from 'vitest';
import type { CLIProvider, ParsedMessage, ProviderCapabilities } from '../../providers/types.js';

describe('Provider types', () => {
  it('ParsedMessage supports provider field', () => {
    const msg: ParsedMessage = {
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
      provider: 'claude',
    };
    expect(msg.provider).toBe('claude');
  });

  it('ParsedMessage provider is optional', () => {
    const msg: ParsedMessage = {
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
    };
    expect(msg.provider).toBeUndefined();
  });
});
```

**Step 3: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/providers/types.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/providers/types.ts server/src/__tests__/providers/types.test.ts
git commit -m "feat: define CLIProvider interface and provider types"
```

---

### Task 2: Create Provider Registry

**Files:**
- Create: `server/src/providers/registry.ts`
- Test: `server/src/__tests__/providers/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// server/src/__tests__/providers/registry.test.ts
import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../providers/registry.js';
import type { CLIProvider } from '../../providers/types.js';

function makeMockProvider(name: string): CLIProvider {
  return {
    name,
    buildCommand: () => '',
    formatInput: (t) => t,
    requestSummary: () => '',
    createParser: () => { throw new Error('not implemented'); },
    extractSessionId: () => null,
    normalizeToolName: (n) => n,
    listRemoteSessions: async () => [],
    syncTranscript: async () => [],
    getCapabilities: () => ({
      nativePlanMode: false,
      nativeTodoTracking: false,
      supportsResume: false,
      supportsStdin: false,
    }),
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry();
    const provider = makeMockProvider('claude');
    registry.register(provider);
    expect(registry.get('claude')).toBe(provider);
  });

  it('returns undefined for unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('lists registered provider names', () => {
    const registry = new ProviderRegistry();
    registry.register(makeMockProvider('claude'));
    registry.register(makeMockProvider('codex'));
    expect(registry.list()).toEqual(['claude', 'codex']);
  });

  it('has a default provider', () => {
    const registry = new ProviderRegistry();
    const claude = makeMockProvider('claude');
    registry.register(claude);
    registry.setDefault('claude');
    expect(registry.getDefault()).toBe(claude);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/providers/registry.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// server/src/providers/registry.ts
import type { CLIProvider } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, CLIProvider>();
  private defaultName: string | null = null;

  register(provider: CLIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): CLIProvider | undefined {
    return this.providers.get(name);
  }

  getDefault(): CLIProvider | undefined {
    if (!this.defaultName) return undefined;
    return this.providers.get(this.defaultName);
  }

  setDefault(name: string): void {
    this.defaultName = name;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/providers/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/providers/registry.ts server/src/__tests__/providers/registry.test.ts
git commit -m "feat: add ProviderRegistry for managing CLI providers"
```

---

### Task 3: Extract Claude Provider from Existing Code

**Files:**
- Create: `server/src/providers/claude/index.ts`
- Create: `server/src/providers/claude/parser.ts`
- Create: `server/src/providers/claude/transcript.ts`
- Modify: `server/src/stream-json-parser.ts` (keep as re-export for backwards compat during migration)
- Modify: `server/src/transcript-parser.ts` (keep as re-export during migration)
- Test: `server/src/__tests__/providers/claude/parser.test.ts`
- Test: `server/src/__tests__/providers/claude/claude-provider.test.ts`

**Step 1: Create Claude parser by moving StreamJsonParser**

Move the `StreamJsonParser` class and `summarizeToolInput` function from `server/src/stream-json-parser.ts` into `server/src/providers/claude/parser.ts`. Make `StreamJsonParser` extend `OutputParser` from types:

```typescript
// server/src/providers/claude/parser.ts
import { OutputParser, type ParsedMessage } from '../types.js';

export class ClaudeStreamParser extends OutputParser {
  private buffer = '';
  private sessionId: string | null = null;

  // ... exact same implementation as current StreamJsonParser
  // feed(), flush(), getSessionId(), processEvent(), emitMessage()
}

export function summarizeToolInput(name: string | undefined, input: any): string {
  // ... exact same implementation
}
```

**Step 2: Create Claude transcript parser**

Move `parseTranscript` from `server/src/transcript-parser.ts` into `server/src/providers/claude/transcript.ts`:

```typescript
// server/src/providers/claude/transcript.ts
import type { ParsedMessage } from '../types.js';
import { summarizeToolInput } from './parser.js';

export function parseClaudeTranscript(jsonlContent: string): ParsedMessage[] {
  // ... exact same implementation as current parseTranscript()
}
```

**Step 3: Create Claude provider**

```typescript
// server/src/providers/claude/index.ts
import type { CLIProvider, SSHExec, OutputParser, ParsedMessage, RemoteSession, ProviderCapabilities } from '../types.js';
import { ClaudeStreamParser } from './parser.js';
import { parseClaudeTranscript } from './transcript.js';

const CLAUDE_BASE_ARGS =
  '--output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions';

function shellCd(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) {
    return `cd $HOME${dir.slice(1)}`;
  }
  return `cd '${dir}'`;
}

export class ClaudeProvider implements CLIProvider {
  readonly name = 'claude';

  buildCommand(opts: {
    resumeSessionId?: string;
    workingDir?: string;
    initialContext?: string;
  }): string {
    const resumeFlag = opts.resumeSessionId ? ` --resume '${opts.resumeSessionId}'` : '';
    const cdPrefix = opts.workingDir ? `${shellCd(opts.workingDir)} && ` : '';
    return `$SHELL -lc "${cdPrefix}claude -p${resumeFlag} ${CLAUDE_BASE_ARGS}"`;
  }

  formatInput(text: string): string {
    return JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
    }) + '\n';
  }

  requestSummary(): string {
    return 'Please summarize the current conversation context in under 500 words. Include: the goal of this session, key decisions made, current progress, and any pending tasks or open questions.';
  }

  createParser(): OutputParser {
    return new ClaudeStreamParser();
  }

  extractSessionId(event: ParsedMessage): string | null {
    if (event.type === 'system' && event.subType === 'init') {
      // Parse session ID from content like "Session started (abc-123)"
      const match = event.content.match(/\(([^)]+)\)/);
      return match?.[1] ?? null;
    }
    return null;
  }

  normalizeToolName(rawName: string): string {
    // Claude tool names are already the Gate standard
    return rawName;
  }

  async listRemoteSessions(runCommand: SSHExec, workingDir: string): Promise<RemoteSession[]> {
    // Resolve to absolute path
    const dir = workingDir.startsWith('~/') ? `$HOME/${workingDir.slice(2)}` : workingDir;
    const { stdout: resolved } = await runCommand(`cd "${dir}" 2>/dev/null && pwd || echo "${dir}"`);
    const absPath = resolved.trim();
    const projectHash = absPath.replace(/[/_]/g, '-');

    const { stdout } = await runCommand(`ls -t ~/.claude/projects/${projectHash}/*.jsonl 2>/dev/null | head -10`);
    return stdout.trim().split('\n')
      .filter(Boolean)
      .map((f) => {
        const basename = f.split('/').pop() ?? '';
        const id = basename.replace('.jsonl', '');
        return { id, label: id };
      })
      .filter((s) => s.id);
  }

  async syncTranscript(runCommand: SSHExec, sessionId: string): Promise<ParsedMessage[]> {
    const { stdout: filePath } = await runCommand(
      `ls ~/.claude/projects/*/${sessionId}.jsonl 2>/dev/null | head -1`
    );
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return [];

    const { stdout: jsonlContent } = await runCommand(`cat '${trimmedPath}'`);
    return parseClaudeTranscript(jsonlContent);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      nativePlanMode: true,
      nativeTodoTracking: true,
      supportsResume: true,
      supportsStdin: true,
    };
  }
}
```

**Step 4: Update old files to re-export for backwards compatibility**

```typescript
// server/src/stream-json-parser.ts — thin re-export
export { ClaudeStreamParser as StreamJsonParser } from './providers/claude/parser.js';
export type { ParsedMessage } from './providers/types.js';
```

```typescript
// server/src/transcript-parser.ts — thin re-export
export { parseClaudeTranscript as parseTranscript } from './providers/claude/transcript.js';
```

**Step 5: Write Claude provider test**

```typescript
// server/src/__tests__/providers/claude/claude-provider.test.ts
import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '../../../providers/claude/index.js';

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider();

  it('has correct name', () => {
    expect(provider.name).toBe('claude');
  });

  it('builds command with working dir', () => {
    const cmd = provider.buildCommand({ workingDir: '~/project' });
    expect(cmd).toContain('claude -p');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain('cd $HOME/project');
  });

  it('builds command with resume session', () => {
    const cmd = provider.buildCommand({ resumeSessionId: 'abc-123' });
    expect(cmd).toContain("--resume 'abc-123'");
  });

  it('formats input as JSON line', () => {
    const input = provider.formatInput('hello');
    const parsed = JSON.parse(input.trim());
    expect(parsed.type).toBe('user');
    expect(parsed.message.content).toBe('hello');
  });

  it('extracts session ID from init message', () => {
    const id = provider.extractSessionId({
      type: 'system',
      subType: 'init',
      content: 'Session started (abc-123)',
      timestamp: Date.now(),
    });
    expect(id).toBe('abc-123');
  });

  it('returns null for non-init messages', () => {
    const id = provider.extractSessionId({
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
    });
    expect(id).toBeNull();
  });

  it('normalizes tool names (identity for Claude)', () => {
    expect(provider.normalizeToolName('Bash')).toBe('Bash');
    expect(provider.normalizeToolName('Read')).toBe('Read');
  });

  it('reports correct capabilities', () => {
    const caps = provider.getCapabilities();
    expect(caps.nativePlanMode).toBe(true);
    expect(caps.nativeTodoTracking).toBe(true);
    expect(caps.supportsResume).toBe(true);
    expect(caps.supportsStdin).toBe(true);
  });
});
```

**Step 6: Copy existing parser tests to new location**

Copy `server/src/__tests__/stream-json-parser.test.ts` to `server/src/__tests__/providers/claude/parser.test.ts`, updating imports to use `ClaudeStreamParser` from `../../../providers/claude/parser.js`.

**Step 7: Run all tests**

Run: `cd server && npx vitest run`
Expected: ALL PASS — existing tests still work via re-exports, new tests pass too

**Step 8: Commit**

```bash
git add server/src/providers/claude/ server/src/__tests__/providers/ server/src/stream-json-parser.ts server/src/transcript-parser.ts
git commit -m "refactor: extract Claude provider from hardcoded implementation"
```

---

### Task 4: Wire Provider into SSHManager

**Files:**
- Modify: `server/src/ssh-manager.ts`
- Modify: `server/src/__tests__/providers/claude/claude-provider.test.ts` (optional integration test)

**Step 1: Refactor SSHManager to accept provider**

Replace `startClaude()` with generic `startCLI()`:

```typescript
// Changes to server/src/ssh-manager.ts

// Remove: CLAUDE_BASE_ARGS constant (line 21-22)
// Remove: buildClaudeCmd() function (line 43-48)
// Remove: shellCd() — moved to provider (keep for runCommand/git methods)

// Rename startClaude → startCLI, accept command string
async startCLI(serverId: string, sessionId: string, command: string): Promise<void> {
  // Same implementation as startClaude but uses `command` parameter
  // instead of calling buildClaudeCmd()
  const conn = this.connections.get(serverId);
  if (!conn) throw new Error(`No connection for server ${serverId}`);

  const existing = conn.channels.get(sessionId);
  if (existing) {
    existing.end();
    conn.channels.delete(sessionId);
  }

  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CLI launch timed out')), 10_000);
    conn.client.exec(command, (err, ch) => {
      clearTimeout(timeout);
      if (err) return reject(err);
      resolve(ch);
    });
  });

  // ... rest same as current startClaude (channel event handlers)
}

// Replace sendInput with generic write
sendInput(serverId: string, sessionId: string, formattedInput: string): void {
  const conn = this.connections.get(serverId);
  const channel = conn?.channels.get(sessionId);
  if (!channel) {
    throw new Error(`No active channel for server ${serverId} session ${sessionId}`);
  }
  channel.write(formattedInput);
}
```

**Step 2: Keep shellCd() in ssh-manager for runCommand/git methods (it's still needed there)**

**Step 3: Run all tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add server/src/ssh-manager.ts
git commit -m "refactor: generalize SSHManager to accept provider-built commands"
```

---

### Task 5: Wire Provider into WebSocket Handler

**Files:**
- Modify: `server/src/ws-handler.ts`
- Modify: `server/src/index.ts`

**Step 1: Update setupWebSocket to accept ProviderRegistry**

```typescript
// server/src/ws-handler.ts
import type { CLIProvider, ParsedMessage } from './providers/types.js';
import { ProviderRegistry } from './providers/registry.js';

// Change function signature:
export function setupWebSocket(
  server: HttpServer,
  db: Database,
  registry: ProviderRegistry,
): WebSocketServer {

// Helper to get provider for a session
function getProvider(sessionId: string): CLIProvider {
  const session = db.getSession(sessionId);
  const providerName = session?.provider ?? 'claude';
  const provider = registry.get(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);
  return provider;
}
```

**Step 2: Update `connect` case to use provider**

Replace hardcoded `sshManager.startClaude()` call (line ~198):

```typescript
case 'connect': {
  // ... existing connection logic ...
  const provider = getProvider(msg.sessionId!);
  const session = db.getSession(msg.sessionId!);
  const cmd = provider.buildCommand({
    resumeSessionId: session?.cliSessionId ?? undefined,
    workingDir: session?.workingDir ?? undefined,
  });
  await sshManager.startCLI(server.id, sessionId, cmd);
  // ... rest unchanged
}
```

**Step 3: Update `input` case to use provider.formatInput()**

```typescript
case 'input': {
  const provider = getProvider(msg.sessionId!);
  sshManager.sendInput(msg.serverId, msg.sessionId!, provider.formatInput(msg.text!));
  // ... save message unchanged
}
```

**Step 4: Update `data` event handler to use provider parser**

Replace direct `StreamJsonParser` creation:

```typescript
sshManager.on('data', (serverId, sessionId, data) => {
  // Get provider for this session
  const session = db.getSession(sessionId);
  const providerName = session?.provider ?? 'claude';
  const provider = registry.get(providerName);
  if (!provider) return;

  if (!parsers.has(sessionId)) {
    const parser = provider.createParser();
    parsers.set(sessionId, parser);
    parser.on('message', (message: ParsedMessage) => {
      // Add provider tag to message
      message.provider = providerName;
      // ... existing persist + broadcast logic

      // Extract CLI session ID using provider
      const cliSessionId = provider.extractSessionId(message);
      if (cliSessionId) {
        db.updateCliSessionId(sessionId, cliSessionId);
      }
    });
  }
  parsers.get(sessionId)!.feed(data);
});
```

**Step 5: Update `list-claude-sessions` to use provider**

Rename to `list-cli-sessions`. Use provider.listRemoteSessions():

```typescript
case 'list-cli-sessions': {
  if (!msg.workingDir) return;
  const providerName = msg.provider ?? 'claude';
  const provider = registry.get(providerName);
  if (!provider) return;

  const runCommand = async (cmd: string) => {
    const { stdout } = await sshManager.runCommand(msg.serverId, null, cmd);
    return { stdout };
  };

  const sessions = await provider.listRemoteSessions(runCommand, msg.workingDir);
  ws.send(JSON.stringify({ type: 'cli-sessions', serverId: msg.serverId, sessions }));
}
```

**Step 6: Update `sync-transcript` to use provider**

```typescript
case 'sync-transcript': {
  const provider = getProvider(msg.sessionId!);
  const session = db.getSession(msg.sessionId!);
  if (!session?.cliSessionId) { /* error */ return; }

  const runCommand = async (cmd: string) => {
    const { stdout } = await sshManager.runCommand(msg.serverId, null, cmd);
    return { stdout };
  };

  const transcriptMessages = await provider.syncTranscript(
    runCommand, session.cliSessionId, session.workingDir ?? undefined
  );
  // ... existing dedup + save logic unchanged
}
```

**Step 7: Update index.ts to create registry**

```typescript
// server/src/index.ts
import { ProviderRegistry } from './providers/registry.js';
import { ClaudeProvider } from './providers/claude/index.js';

const registry = new ProviderRegistry();
registry.register(new ClaudeProvider());
registry.setDefault('claude');

const wss = setupWebSocket(httpServer, db, registry);
```

**Step 8: Run all tests + dev server**

Run: `cd server && npx vitest run`
Run: `npm run dev:server` (verify it starts without errors)
Expected: PASS

**Step 9: Commit**

```bash
git add server/src/ws-handler.ts server/src/index.ts server/src/ssh-manager.ts
git commit -m "refactor: wire provider registry into WebSocket handler and server"
```

---

### Task 6: Update Database Schema

**Files:**
- Modify: `server/src/db.ts`
- Modify: `server/src/__tests__/db.test.ts`

**Step 1: Write failing test**

```typescript
// Add to db.test.ts
it('should create session with provider field', () => {
  const server = db.createServer({ name: 'S1', host: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p' });
  const session = db.createSession(server.id, 'test', undefined, 'codex');
  expect(session.provider).toBe('codex');
});

it('should default provider to claude', () => {
  const server = db.createServer({ name: 'S1', host: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p' });
  const session = db.createSession(server.id, 'test');
  expect(session.provider).toBe('claude');
});

it('should save and retrieve message with provider', () => {
  const server = db.createServer({ name: 'S1', host: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p' });
  const session = db.createSession(server.id, 'test');
  db.saveMessage({ sessionId: session.id, type: 'assistant', content: 'hi', timestamp: Date.now(), provider: 'codex' });
  const msgs = db.getMessages(session.id);
  expect(msgs[0].provider).toBe('codex');
});
```

**Step 2: Run to verify failure**

Run: `cd server && npx vitest run src/__tests__/db.test.ts`
Expected: FAIL

**Step 3: Update db.ts**

Changes to Session interface:
```typescript
export interface Session {
  id: string;
  serverId: string;
  name: string;
  cliSessionId: string | null;  // renamed from claudeSessionId
  provider: string;             // 'claude' | 'codex' | ...
  workingDir: string | null;
  createdAt: number;
  lastActiveAt: number;
}
```

Changes to Message interface:
```typescript
export interface Message {
  id: string;
  sessionId: string;
  type: string;
  content: string;
  toolName: string | null;
  toolDetail: string | null;
  timestamp: number;
  provider: string | null;  // NEW
}
```

Migration in createDb():
```typescript
try { db.exec('ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT \'claude\''); } catch { /* already exists */ }
try { db.exec('ALTER TABLE sessions ADD COLUMN cliSessionId TEXT'); } catch { /* already exists */ }
try { db.exec('ALTER TABLE messages ADD COLUMN provider TEXT'); } catch { /* already exists */ }
// Copy existing claudeSessionId data to cliSessionId
try { db.exec('UPDATE sessions SET cliSessionId = claudeSessionId WHERE cliSessionId IS NULL AND claudeSessionId IS NOT NULL'); } catch { /* ignore */ }
```

Update createSession():
```typescript
createSession(serverId: string, name: string, workingDir?: string, provider?: string) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO sessions (id, serverId, name, tmuxSession, workingDir, provider, createdAt, lastActiveAt)
    VALUES (?, ?, ?, '', ?, ?, ?, ?)
  `).run(id, serverId, name, workingDir ?? null, provider ?? 'claude', Date.now(), Date.now());
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session;
}
```

Rename `updateClaudeSessionId` → `updateCliSessionId`:
```typescript
updateCliSessionId(id: string, cliSessionId: string) {
  db.prepare('UPDATE sessions SET cliSessionId = ? WHERE id = ?').run(cliSessionId, id);
}
```

Update saveMessage to include provider:
```typescript
saveMessage(input: { sessionId: string; type: string; content: string; toolName?: string; toolDetail?: string; timestamp: number; provider?: string }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO messages (id, sessionId, type, content, toolName, toolDetail, timestamp, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.sessionId, input.type, input.content, input.toolName ?? null, input.toolDetail ?? null, input.timestamp, input.provider ?? null);
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/__tests__/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/db.ts server/src/__tests__/db.test.ts
git commit -m "feat: add provider field to sessions and messages schema"
```

---

## Phase 2: Codex Provider

### Task 7: Implement Codex Parser

**Files:**
- Create: `server/src/providers/codex/parser.ts`
- Test: `server/src/__tests__/providers/codex/parser.test.ts`

**Step 1: Write failing tests**

```typescript
// server/src/__tests__/providers/codex/parser.test.ts
import { describe, it, expect } from 'vitest';
import { CodexStreamParser } from '../../../providers/codex/parser.js';
import type { ParsedMessage } from '../../../providers/types.js';

function collect(parser: CodexStreamParser): ParsedMessage[] {
  const msgs: ParsedMessage[] = [];
  parser.on('message', (m: ParsedMessage) => msgs.push(m));
  return msgs;
}

describe('CodexStreamParser', () => {
  it('parses thread.started event', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed('{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('init');
    expect(parser.getSessionId()).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
  });

  it('parses agent_message item.completed', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: 'Hello from Codex' },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hello from Codex');
  });

  it('parses command_execution item.completed', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    // item.started for tool_call
    parser.feed(JSON.stringify({
      type: 'item.started',
      item: { id: 'item_2', type: 'command_execution', command: 'bash -lc ls -la', status: 'in_progress' },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('command_execution');
    expect(msgs[0].toolDetail).toBe('ls -la');

    // item.completed for tool_result
    parser.feed(JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_2', type: 'command_execution', command: 'bash -lc ls -la', output: 'file1.ts\nfile2.ts', exit_code: 0 },
    }) + '\n');
    expect(msgs).toHaveLength(2);
    expect(msgs[1].type).toBe('tool_result');
    expect(msgs[1].content).toBe('file1.ts\nfile2.ts');
  });

  it('parses file_change item', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'item.started',
      item: { id: 'item_3', type: 'file_change', file: 'src/main.ts', status: 'in_progress' },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('file_change');
    expect(msgs[0].toolDetail).toBe('src/main.ts');
  });

  it('parses turn.completed with usage', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 24763, output_tokens: 122 },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('result');
  });

  it('ignores turn.started and reasoning events', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed('{"type":"turn.started"}\n');
    parser.feed(JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_r', type: 'reasoning', text: 'thinking...' },
    }) + '\n');
    expect(msgs).toHaveLength(0);
  });

  it('buffers incomplete lines', () => {
    const parser = new CodexStreamParser();
    const msgs = collect(parser);
    parser.feed('{"type":"item.comple');
    expect(msgs).toHaveLength(0);
    parser.feed('ted","item":{"id":"i1","type":"agent_message","text":"hi"}}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hi');
  });
});
```

**Step 2: Run test to verify failure**

Run: `cd server && npx vitest run src/__tests__/providers/codex/parser.test.ts`
Expected: FAIL — module not found

**Step 3: Implement CodexStreamParser**

```typescript
// server/src/providers/codex/parser.ts
import { OutputParser, type ParsedMessage } from '../types.js';

/**
 * Parses NDJSON output from `codex exec --json`.
 *
 * Event types:
 *   - {type:"thread.started", thread_id}
 *   - {type:"turn.started"}
 *   - {type:"item.started", item:{id, type, ...}}
 *   - {type:"item.completed", item:{id, type, text?, output?, ...}}
 *   - {type:"turn.completed", usage:{input_tokens, output_tokens}}
 *   - {type:"turn.failed", error}
 *   - {type:"error", message}
 */
export class CodexStreamParser extends OutputParser {
  private buffer = '';
  private sessionId: string | null = null;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.processEvent(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  }

  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try { this.processEvent(JSON.parse(trimmed)); } catch { /* ignore */ }
    }
    this.buffer = '';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private processEvent(obj: any): void {
    if (obj.type === 'thread.started') {
      this.sessionId = obj.thread_id ?? null;
      this.emit('message', {
        type: 'system',
        subType: 'init',
        content: `Session started${obj.thread_id ? ` (${obj.thread_id})` : ''}`,
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'turn.completed') {
      const parts: string[] = [];
      if (obj.usage?.input_tokens != null) parts.push(`Input: ${obj.usage.input_tokens} tokens`);
      if (obj.usage?.output_tokens != null) parts.push(`Output: ${obj.usage.output_tokens} tokens`);
      this.emit('message', {
        type: 'system',
        subType: 'result',
        content: parts.join(' | ') || 'Turn complete',
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'turn.failed' || obj.type === 'error') {
      this.emit('message', {
        type: 'system',
        subType: 'error',
        content: obj.error?.message ?? obj.message ?? 'Unknown error',
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'item.started') {
      const item = obj.item;
      if (!item) return;

      if (item.type === 'command_execution') {
        // Strip "bash -lc " prefix from command display
        const command = (item.command ?? '').replace(/^bash\s+-lc\s+/, '');
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: 'command_execution',
          toolDetail: command,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'file_change') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ file: item.file }, null, 2),
          toolName: 'file_change',
          toolDetail: item.file ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'mcp_tool_call') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify(item.input ?? {}, null, 2),
          toolName: item.name ?? 'mcp_tool',
          toolDetail: item.name ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      }
      return;
    }

    if (obj.type === 'item.completed') {
      const item = obj.item;
      if (!item) return;

      if (item.type === 'agent_message') {
        this.emit('message', {
          type: 'assistant',
          content: item.text ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'command_execution') {
        this.emit('message', {
          type: 'tool_result',
          content: item.output ?? `Exit code: ${item.exit_code ?? 0}`,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'file_change') {
        this.emit('message', {
          type: 'tool_result',
          content: item.diff ?? item.content ?? 'File changed',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'todo_list') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify(item.todos ?? item, null, 2),
          toolName: 'TodoWrite',
          toolDetail: 'Task list update',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      }
      // Skip: reasoning, unknown
      return;
    }

    // Ignore: turn.started, etc.
  }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/__tests__/providers/codex/parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/providers/codex/parser.ts server/src/__tests__/providers/codex/parser.test.ts
git commit -m "feat: implement Codex CLI stream parser"
```

---

### Task 8: Implement Codex Transcript Parser

**Files:**
- Create: `server/src/providers/codex/transcript.ts`
- Test: `server/src/__tests__/providers/codex/transcript.test.ts`

**Step 1: Write failing test**

```typescript
// server/src/__tests__/providers/codex/transcript.test.ts
import { describe, it, expect } from 'vitest';
import { parseCodexTranscript } from '../../../providers/codex/transcript.js';

describe('parseCodexTranscript', () => {
  it('parses agent_message from rollout JSONL', () => {
    const line = JSON.stringify({
      timestamp: '2025-06-01T10:00:00.123Z',
      type: 'ResponseItem',
      payload: { type: 'agent_message', text: 'Hello from Codex' },
    });
    const msgs = parseCodexTranscript(line);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hello from Codex');
  });

  it('parses SessionMeta and extracts cwd', () => {
    const line = JSON.stringify({
      timestamp: '2025-06-01T10:00:00.000Z',
      type: 'SessionMeta',
      payload: { id: 'abc-123', cwd: '/home/user/project' },
    });
    const msgs = parseCodexTranscript(line);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('init');
  });

  it('skips malformed lines', () => {
    const lines = 'not json\n' + JSON.stringify({
      timestamp: '2025-06-01T10:00:00.000Z',
      type: 'ResponseItem',
      payload: { type: 'agent_message', text: 'hello' },
    });
    const msgs = parseCodexTranscript(lines);
    expect(msgs).toHaveLength(1);
  });
});
```

**Step 2: Run to verify failure**

Run: `cd server && npx vitest run src/__tests__/providers/codex/transcript.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// server/src/providers/codex/transcript.ts
import type { ParsedMessage } from '../types.js';

/**
 * Parses a Codex rollout JSONL file into Gate-compatible messages.
 *
 * Rollout format: {timestamp, type: "SessionMeta"|"ResponseItem"|"TurnContext"|..., payload: {...}}
 */
export function parseCodexTranscript(jsonlContent: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const lines = jsonlContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: any;
    try { obj = JSON.parse(trimmed); } catch { continue; }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
    const payload = obj.payload ?? obj;

    if (obj.type === 'SessionMeta') {
      messages.push({
        type: 'system',
        subType: 'init',
        content: `Session started (${payload.id ?? 'unknown'})`,
        timestamp: ts,
      });
      continue;
    }

    if (obj.type === 'ResponseItem' || obj.type === 'response_item') {
      if (payload.type === 'agent_message') {
        messages.push({ type: 'assistant', content: payload.text ?? '', timestamp: ts });
      } else if (payload.type === 'command_execution') {
        const command = (payload.command ?? '').replace(/^bash\s+-lc\s+/, '');
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: 'command_execution',
          toolDetail: command,
          timestamp: ts,
        });
        if (payload.output != null) {
          messages.push({ type: 'tool_result', content: payload.output, timestamp: ts });
        }
      } else if (payload.type === 'file_change') {
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ file: payload.file }, null, 2),
          toolName: 'file_change',
          toolDetail: payload.file ?? '',
          timestamp: ts,
        });
      }
    }
  }

  return messages;
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/__tests__/providers/codex/transcript.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/providers/codex/transcript.ts server/src/__tests__/providers/codex/transcript.test.ts
git commit -m "feat: implement Codex transcript parser"
```

---

### Task 9: Implement Codex Provider

**Files:**
- Create: `server/src/providers/codex/index.ts`
- Test: `server/src/__tests__/providers/codex/codex-provider.test.ts`

**Step 1: Write failing test**

```typescript
// server/src/__tests__/providers/codex/codex-provider.test.ts
import { describe, it, expect } from 'vitest';
import { CodexProvider } from '../../../providers/codex/index.js';

describe('CodexProvider', () => {
  const provider = new CodexProvider();

  it('has correct name', () => {
    expect(provider.name).toBe('codex');
  });

  it('builds command with working dir', () => {
    const cmd = provider.buildCommand({ workingDir: '~/project' });
    expect(cmd).toContain('codex');
    expect(cmd).toContain('--json');
    expect(cmd).toContain('cd $HOME/project');
  });

  it('builds command with resume session', () => {
    const cmd = provider.buildCommand({ resumeSessionId: 'abc-123' });
    expect(cmd).toContain('resume');
    expect(cmd).toContain('abc-123');
  });

  it('builds command with initial context', () => {
    const cmd = provider.buildCommand({
      workingDir: '~/project',
      initialContext: 'Previous context summary here',
    });
    expect(cmd).toContain('Previous context summary here');
  });

  it('formats input as plain text (no JSON wrapper)', () => {
    const input = provider.formatInput('hello');
    // Codex exec takes prompt as argument, not stdin JSON
    expect(input).toBe('hello\n');
  });

  it('normalizes tool names', () => {
    expect(provider.normalizeToolName('command_execution')).toBe('Bash');
    expect(provider.normalizeToolName('file_change')).toBe('Edit');
    expect(provider.normalizeToolName('unknown_tool')).toBe('unknown_tool');
  });

  it('extracts session ID from init message', () => {
    const id = provider.extractSessionId({
      type: 'system',
      subType: 'init',
      content: 'Session started (0199a213-81c0-7800-8aa1-bbab2a035a53)',
      timestamp: Date.now(),
    });
    expect(id).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
  });

  it('reports correct capabilities', () => {
    const caps = provider.getCapabilities();
    expect(caps.nativePlanMode).toBe(false);
    expect(caps.nativeTodoTracking).toBe(true);
    expect(caps.supportsResume).toBe(true);
    expect(caps.supportsStdin).toBe(false);
  });
});
```

**Step 2: Run to verify failure**

Run: `cd server && npx vitest run src/__tests__/providers/codex/codex-provider.test.ts`
Expected: FAIL

**Step 3: Implement CodexProvider**

```typescript
// server/src/providers/codex/index.ts
import type { CLIProvider, SSHExec, OutputParser, ParsedMessage, RemoteSession, ProviderCapabilities } from '../types.js';
import { CodexStreamParser } from './parser.js';
import { parseCodexTranscript } from './transcript.js';

function shellCd(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) return `cd $HOME${dir.slice(1)}`;
  return `cd '${dir}'`;
}

export class CodexProvider implements CLIProvider {
  readonly name = 'codex';

  buildCommand(opts: {
    resumeSessionId?: string;
    workingDir?: string;
    initialContext?: string;
  }): string {
    const cdPrefix = opts.workingDir ? `${shellCd(opts.workingDir)} && ` : '';

    if (opts.resumeSessionId) {
      return `$SHELL -lc "${cdPrefix}codex exec --json resume '${opts.resumeSessionId}'"`;
    }

    // Build prompt: either initial context or a default start prompt
    const prompt = opts.initialContext
      ? opts.initialContext.replace(/"/g, '\\"').replace(/\n/g, '\\n')
      : 'You are ready. Wait for instructions.';

    return `$SHELL -lc "${cdPrefix}codex exec --json --full-auto \\"${prompt}\\""`;
  }

  formatInput(text: string): string {
    // Codex in exec mode: input goes as plain text stdin
    return text + '\n';
  }

  requestSummary(): string {
    return 'Please summarize the current conversation context in under 500 words. Include: the goal of this session, key decisions made, current progress, and any pending tasks or open questions.';
  }

  createParser(): OutputParser {
    return new CodexStreamParser();
  }

  extractSessionId(event: ParsedMessage): string | null {
    if (event.type === 'system' && event.subType === 'init') {
      const match = event.content.match(/\(([^)]+)\)/);
      return match?.[1] ?? null;
    }
    return null;
  }

  normalizeToolName(rawName: string): string {
    switch (rawName) {
      case 'command_execution': return 'Bash';
      case 'file_change': return 'Edit';
      case 'web_search': return 'WebSearch';
      case 'todo_list': return 'TodoWrite';
      default: return rawName;
    }
  }

  async listRemoteSessions(runCommand: SSHExec, workingDir: string): Promise<RemoteSession[]> {
    // Resolve working dir to absolute path
    const dir = workingDir.startsWith('~/') ? `$HOME/${workingDir.slice(2)}` : workingDir;
    const { stdout: resolved } = await runCommand(`cd "${dir}" 2>/dev/null && pwd || echo "${dir}"`);
    const absPath = resolved.trim();

    // Find all rollout files, read first line of each to get SessionMeta with cwd
    const { stdout } = await runCommand(
      `find ~/.codex/sessions -name 'rollout-*.jsonl' -type f 2>/dev/null | sort -r | head -20`
    );
    const files = stdout.trim().split('\n').filter(Boolean);

    const sessions: RemoteSession[] = [];
    for (const file of files) {
      const { stdout: head } = await runCommand(`head -1 '${file}'`);
      try {
        const meta = JSON.parse(head.trim());
        const payload = meta.payload ?? meta;
        if (payload.cwd && payload.cwd === absPath) {
          sessions.push({
            id: payload.id ?? file.split('/').pop()?.replace('.jsonl', '') ?? '',
            timestamp: meta.timestamp ? new Date(meta.timestamp).getTime() : undefined,
            label: payload.id,
          });
        }
      } catch { continue; }
    }
    return sessions;
  }

  async syncTranscript(runCommand: SSHExec, sessionId: string): Promise<ParsedMessage[]> {
    // Search for rollout file containing this session ID
    const { stdout: filePath } = await runCommand(
      `grep -rl '"${sessionId}"' ~/.codex/sessions/ 2>/dev/null | head -1`
    );
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return [];

    const { stdout: content } = await runCommand(`cat '${trimmedPath}'`);
    return parseCodexTranscript(content);
  }

  getCapabilities(): ProviderCapabilities {
    return {
      nativePlanMode: false,
      nativeTodoTracking: true,
      supportsResume: true,
      supportsStdin: false,
    };
  }
}
```

**Step 4: Run tests**

Run: `cd server && npx vitest run src/__tests__/providers/codex/codex-provider.test.ts`
Expected: PASS

**Step 5: Register Codex provider in index.ts**

```typescript
// Add to server/src/index.ts
import { CodexProvider } from './providers/codex/index.js';

registry.register(new CodexProvider());
```

**Step 6: Run all tests**

Run: `cd server && npx vitest run`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add server/src/providers/codex/ server/src/__tests__/providers/codex/ server/src/index.ts
git commit -m "feat: implement Codex CLI provider"
```

---

## Phase 3: Tool Switching

### Task 10: Implement Context Compaction and Tool Switch

**Files:**
- Modify: `server/src/ws-handler.ts`

**Step 1: Add `switch-provider` message type to ClientMessage**

```typescript
interface ClientMessage {
  type: '...' | 'switch-provider';
  // ...existing fields...
  provider?: string;  // target provider name for switch
}
```

**Step 2: Implement switch-provider handler**

```typescript
case 'switch-provider': {
  if (!msg.sessionId || !msg.provider) return;
  const session = db.getSession(msg.sessionId);
  if (!session) return;

  const currentProvider = registry.get(session.provider ?? 'claude');
  const targetProvider = registry.get(msg.provider);
  if (!currentProvider || !targetProvider) {
    ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: `Unknown provider: ${msg.provider}` }));
    return;
  }

  try {
    // Step 1: Request summary from current CLI
    let summary = '';
    if (sshManager.hasActiveChannel(msg.serverId, msg.sessionId)) {
      const summaryPrompt = currentProvider.requestSummary();
      sshManager.sendInput(msg.serverId, msg.sessionId, currentProvider.formatInput(summaryPrompt));

      // Wait for assistant response (with timeout)
      summary = await new Promise<string>((resolve) => {
        const parser = parsers.get(msg.sessionId!);
        const timeout = setTimeout(() => resolve(''), 15_000);
        const handler = (message: ParsedMessage) => {
          if (message.type === 'assistant') {
            clearTimeout(timeout);
            parser?.removeListener('message', handler);
            resolve(message.content);
          }
        };
        parser?.on('message', handler);
      });
    }

    // Fallback: use recent messages from DB
    if (!summary) {
      const recentMessages = db.getMessages(msg.sessionId, 20);
      summary = recentMessages
        .filter(m => m.type === 'assistant' || m.type === 'user')
        .map(m => `${m.type}: ${m.content}`)
        .join('\n')
        .slice(0, 2000);
    }

    // Step 2: Disconnect current CLI
    const parser = parsers.get(msg.sessionId);
    if (parser) { parser.flush(); parsers.delete(msg.sessionId); }
    sshManager.stopSession(msg.serverId, msg.sessionId);

    // Step 3: Update session provider
    db.updateSessionProvider(msg.sessionId, msg.provider);

    // Step 4: Insert system message about the switch
    const switchMessage = {
      sessionId: msg.sessionId,
      type: 'system' as const,
      content: `Switched from ${session.provider ?? 'claude'} to ${msg.provider}. Context synced.`,
      timestamp: Date.now(),
      provider: msg.provider,
    };
    db.saveMessage(switchMessage);
    broadcast(wss, { type: 'message', serverId: msg.serverId, sessionId: msg.sessionId, message: switchMessage });

    // Step 5: Launch new CLI with context
    const cmd = targetProvider.buildCommand({
      workingDir: session.workingDir ?? undefined,
      initialContext: summary,
    });
    await sshManager.startCLI(msg.serverId, msg.sessionId, cmd);

    broadcast(wss, { type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'connected' });
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
  }
  break;
}
```

**Step 3: Add `updateSessionProvider` to db.ts**

```typescript
updateSessionProvider(id: string, provider: string) {
  db.prepare('UPDATE sessions SET provider = ?, cliSessionId = NULL WHERE id = ?').run(provider, id);
}
```

**Step 4: Run all tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/ws-handler.ts server/src/db.ts
git commit -m "feat: implement provider switching with context compaction"
```

---

## Phase 4: Frontend Adaptation

### Task 11: Add Provider to Client Session Model

**Files:**
- Modify: `client/src/stores/session-store.ts`
- Modify: `client/src/hooks/use-websocket.ts`

**Step 1: Update Session interface**

```typescript
// client/src/stores/session-store.ts
export interface Session {
  id: string;
  serverId: string;
  name: string;
  cliSessionId: string | null;  // renamed from claudeSessionId
  provider: string;             // 'claude' | 'codex'
  workingDir: string | null;
  createdAt: number;
  lastActiveAt: number;
}
```

**Step 2: Update useWebSocket hook**

Add `switchProvider` and update `listCliSessions` (rename from `listClaudeSessions`):

```typescript
// In use-websocket.ts
switchProvider(serverId: string, sessionId: string, provider: string) {
  ws?.send(JSON.stringify({ type: 'switch-provider', serverId, sessionId, provider }));
},

listCliSessions(serverId: string, workingDir: string, provider: string): Promise<...> {
  // ... same as listClaudeSessions but sends provider field
  ws?.send(JSON.stringify({ type: 'list-cli-sessions', serverId, workingDir, provider }));
}
```

**Step 3: Update WebSocket message handler for renamed events**

Replace `'claude-sessions'` → `'cli-sessions'` in the message switch.

**Step 4: Commit**

```bash
git add client/src/stores/session-store.ts client/src/hooks/use-websocket.ts
git commit -m "feat: add provider support to client session model"
```

---

### Task 12: Provider Bubble Colors

**Files:**
- Create: `client/src/lib/provider-colors.ts`
- Modify: `client/src/components/chat/MessageBubble.tsx`

**Step 1: Create color mapping**

```typescript
// client/src/lib/provider-colors.ts
const providerColors: Record<string, { bg: string; border: string }> = {
  claude: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
  },
  codex: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
};

export function getProviderStyle(provider?: string | null): { bg: string; border: string } {
  if (!provider) return { bg: '', border: '' };
  return providerColors[provider] ?? { bg: 'bg-gray-50 dark:bg-gray-950/30', border: 'border-gray-200 dark:border-gray-800' };
}
```

**Step 2: Update MessageBubble to use provider colors**

In `MessageBubble.tsx`, for assistant messages, apply the provider background:

```tsx
// MessageBubble.tsx — assistant message section
import { getProviderStyle } from '../../lib/provider-colors';

// In the assistant message rendering:
const providerStyle = getProviderStyle(message.provider);
// Apply providerStyle.bg and providerStyle.border as additional classes
```

**Step 3: Commit**

```bash
git add client/src/lib/provider-colors.ts client/src/components/chat/MessageBubble.tsx
git commit -m "feat: add provider-based bubble background colors"
```

---

### Task 13: Provider Switcher UI

**Files:**
- Create: `client/src/components/chat/ProviderSwitcher.tsx`
- Modify: `client/src/components/chat/ChatInput.tsx` or TopBar component

**Step 1: Create ProviderSwitcher component**

A small dropdown or toggle button showing current provider with option to switch:

```tsx
// client/src/components/chat/ProviderSwitcher.tsx
import { useSessionStore } from '../../stores/session-store';
import { useWebSocket } from '../../hooks/use-websocket';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const providers = [
  { name: 'claude', label: 'Claude' },
  { name: 'codex', label: 'Codex' },
];

export function ProviderSwitcher() {
  const { activeSession } = useSessionStore();
  const { switchProvider } = useWebSocket();

  if (!activeSession) return null;

  const handleSwitch = (provider: string) => {
    if (provider === activeSession.provider) return;
    switchProvider(activeSession.serverId, activeSession.id, provider);
  };

  return (
    <Select value={activeSession.provider ?? 'claude'} onValueChange={handleSwitch}>
      <SelectTrigger className="w-[100px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {providers.map(p => (
          <SelectItem key={p.name} value={p.name}>{p.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

**Step 2: Add to TopBar or ChatInput area**

Place the switcher in the session top bar near the session name.

**Step 3: Commit**

```bash
git add client/src/components/chat/ProviderSwitcher.tsx
git commit -m "feat: add provider switcher UI component"
```

---

### Task 14: Update CreateSessionDialog for Provider Selection

**Files:**
- Modify: `client/src/components/chat/CreateSessionDialog.tsx`

**Step 1: Add provider selector to dialog**

Add a radio group or select for choosing provider when creating a new session. Default to 'claude'.

**Step 2: Update create-session message to include provider**

```typescript
// In ws-handler.ts create-session case, accept provider field
case 'create-session': {
  const session = db.createSession(msg.serverId, msg.sessionName ?? 'New Session', msg.workingDir, msg.provider);
  // ...
}
```

**Step 3: Update listCliSessions to pass provider**

When working dir changes, fetch CLI sessions for the selected provider.

**Step 4: Commit**

```bash
git add client/src/components/chat/CreateSessionDialog.tsx server/src/ws-handler.ts
git commit -m "feat: add provider selection to create session dialog"
```

---

### Task 15: Update Plan Mode Store for Provider Capabilities

**Files:**
- Modify: `client/src/stores/plan-mode-store.ts`

**Step 1: Check provider capabilities before entering native plan mode**

The plan mode store currently unconditionally handles `EnterPlanMode` tool calls. Add a check: if the current session's provider doesn't have `nativePlanMode`, skip the native plan overlay and let Gate's markdown extraction handle it.

```typescript
// In processMessage:
if (message.type === 'tool_call' && message.toolName === 'EnterPlanMode') {
  // Only enter native plan mode if provider supports it
  // (The capabilities should be passed via session store or a context)
  setPhase('active');
  // ...
}
```

This works naturally since only Claude emits `EnterPlanMode` tool calls. Codex never will.

**Step 2: Commit**

```bash
git add client/src/stores/plan-mode-store.ts
git commit -m "refactor: plan mode respects provider capabilities"
```

---

### Task 16: Normalize Tool Names in Frontend

**Files:**
- Modify: `client/src/components/chat/ToolActivityBlock.tsx`

**Step 1: Update to handle normalized Codex tool names**

Since `normalizeToolName()` maps `command_execution` → `Bash` and `file_change` → `Edit` on the server side, the frontend icon mapping should already work. Verify and add any missing mappings if needed.

**Step 2: Commit if changes needed**

```bash
git add client/src/components/chat/ToolActivityBlock.tsx
git commit -m "fix: ensure tool icon mapping covers all provider tool names"
```

---

## Phase 5: Integration Testing & Cleanup

### Task 17: End-to-End Verification

**Step 1: Run all server tests**

Run: `cd server && npx vitest run`
Expected: ALL PASS

**Step 2: Run type check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

**Step 3: Start dev server and verify**

Run: `npm run dev`
Expected: Both client and server start without errors

**Step 4: Manual verification checklist**
- [ ] Create session with Claude provider — works as before
- [ ] Create session with Codex provider — launches Codex CLI
- [ ] Switch provider mid-session — context compaction works
- [ ] Provider bubble colors render correctly
- [ ] Plan mode works with Claude provider
- [ ] Plan extraction from markdown works with Codex provider
- [ ] Session listing works for both providers
- [ ] Transcript sync works for both providers

**Step 5: Commit any final fixes**

```bash
git commit -m "fix: integration fixes for multi-provider support"
```

---

### Task 18: Remove Backwards Compatibility Shims

**Files:**
- Modify: `server/src/stream-json-parser.ts` — inline the re-export or remove if no external consumers
- Modify: `server/src/transcript-parser.ts` — same
- Update all imports in ws-handler.ts to use providers/types directly

**Step 1: Update imports everywhere to use new paths**

**Step 2: Run tests**

Run: `cd server && npx vitest run`
Expected: PASS

**Step 3: Commit**

```bash
git commit -m "refactor: remove backwards compatibility shims for old parser paths"
```

---

### Task 19: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `README_CN.md`

**Step 1: Update CLAUDE.md**

Add provider architecture to Key Modules section. Update WebSocket Protocol with new message types (`switch-provider`, `list-cli-sessions`, `cli-sessions`).

**Step 2: Update READMEs**

Add Codex support to feature list. Document provider switching.

**Step 3: Commit**

```bash
git add CLAUDE.md README.md README_CN.md
git commit -m "docs: update documentation for multi-CLI provider support"
```
