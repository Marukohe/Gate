# Multi-CLI Provider Architecture Design

**Date**: 2026-03-07
**Status**: Approved

## Goal

Abstract Gate's CLI integration layer so it supports multiple coding CLI tools (Claude Code, Codex, and future tools) within a unified three-layer architecture:

```
Web Client → Gate Server (Provider Abstraction) → CLI Tool via SSH
```

## Key Design Decisions

1. **Gate Session = Working Directory**, not bound to a specific CLI tool. Users can switch tools within the same session.
2. **Context compaction on tool switch**: Before switching, the current CLI is asked to summarize the conversation. The summary is injected into the new CLI as initial context.
3. **Plan/Todo is a Gate-level feature**: Gate extracts markdown checklists from assistant messages regardless of CLI tool. Providers with native plan mode (e.g., Claude's `EnterPlanMode`) provide enhanced experience, but the feature works without it.
4. **Different provider messages use different bubble background colors** (not icons) to visually distinguish which CLI produced the response.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Gate Web Client                 │
│  (Session = working dir, switchable CLI tool)    │
│  Plan/Todo: Gate-maintained, CLI-independent     │
└──────────────────┬──────────────────────────────┘
                   │ WebSocket
┌──────────────────┴──────────────────────────────┐
│               Gate Server Core                   │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Session   │  │ Message  │  │ Plan/Todo    │  │
│  │ Manager   │  │ Router   │  │ Engine       │  │
│  └─────┬─────┘  └────┬─────┘  └──────────────┘  │
│        │              │                          │
│  ┌─────┴──────────────┴─────────────────────┐    │
│  │        Provider Interface (Abstraction)    │    │
│  └──┬──────────────────┬────────────────┬────┘    │
│     │                  │                │        │
│  ┌──┴───┐  ┌──────┴───────┐  ┌───┴────┐        │
│  │Claude│  │   Codex      │  │Future..│        │
│  └──────┘  └──────────────┘  └────────┘        │
└──────────────────┬──────────────────────────────┘
                   │ SSH
            ┌──────┴──────┐
            │Remote Server│
            └─────────────┘
```

## Provider Interface

```typescript
interface CLIProvider {
  name: string;  // 'claude' | 'codex'

  // === Lifecycle ===
  buildCommand(opts: {
    resumeSessionId?: string;
    workingDir?: string;
    initialContext?: string;  // summary injected on tool switch
  }): string;

  formatInput(text: string): string;

  // Returns the prompt text to send to CLI for context summarization
  requestSummary(): string;

  // === Parsing ===
  createParser(): OutputParser;
  extractSessionId(event: ParsedMessage): string | null;

  // Map CLI-specific tool names to Gate standard names
  // Claude: Read/Write/Edit/Bash/Glob/Grep/...
  // Codex: command_execution→bash, file_change→edit, ...
  normalizeToolName(rawName: string): string;

  // === Remote Sessions ===
  listRemoteSessions(
    runCommand: SSHExec,
    workingDir: string
  ): Promise<RemoteSession[]>;

  syncTranscript(
    runCommand: SSHExec,
    sessionId: string,
    workingDir?: string
  ): Promise<ParsedMessage[]>;

  // === Capabilities ===
  getCapabilities(): ProviderCapabilities;
}

interface ProviderCapabilities {
  nativePlanMode: boolean;
  nativeTodoTracking: boolean;
  supportsResume: boolean;
  supportsStdin: boolean;
}

interface OutputParser extends EventEmitter {
  feed(chunk: string): void;
  // emits: 'message' → ParsedMessage (unified format)
}

interface RemoteSession {
  id: string;
  timestamp?: number;
  label?: string;
}

type SSHExec = (command: string) => Promise<{ stdout: string }>;
```

## Database Changes

```sql
-- sessions table
ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude';
-- Rename claudeSessionId → cliSessionId (generalized)
ALTER TABLE sessions ADD COLUMN cliSessionId TEXT;
```

Messages table gains an optional `provider` field so bubble colors can be determined per-message.

## Tool Switch Flow

```
User clicks "Switch to Codex"
  │
  ▼
① Send requestSummary() prompt to current CLI
  ("Summarize current context: goals, decisions, progress, and pending items")
  │
  ▼
② Wait for assistant reply, extract summary text
  │
  ▼
③ Disconnect current CLI
  │
  ▼
④ Update session.provider = 'codex', clear session.cliSessionId
  │
  ▼
⑤ Launch new CLI via provider.buildCommand({ initialContext: summary, workingDir })
  │
  ▼
⑥ Insert system message: "Switched from Claude to Codex. Context synced."
  │
  ▼
⑦ Continue conversation, history preserved in same session
```

**Fallback**: If CLI times out on summary request, fall back to formatting recent N messages from Gate DB as markdown context.

**Stdin limitation**: If new CLI doesn't support stdin for initial context, write summary to a temp file and pass via CLI argument or `--file` flag.

## Plan/Todo Engine (Gate-Level)

```
Source 1: Extract markdown checklists from assistant messages (existing)
  "- [ ] Implement auth"  →  PlanStep { content, completed: false }

Source 2: Provider enhancement (optional)
  Claude TodoWrite tool   →  Parse JSON directly, higher precision
  Codex todo_list item    →  normalizeToolName() maps it, same handling
  Unsupported CLI         →  Source 1 only, still functional
```

Plan Mode:
- Provider has `nativePlanMode` → use CLI's native flow (Claude: EnterPlanMode → AskUserQuestion → ExitPlanMode)
- Provider lacks it → user manually asks CLI to create a plan, Gate extracts checklist from response

## Claude Provider Details

- Command: `claude -p --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions`
- Resume: `--resume '<sessionId>'`
- Input format: `{"type":"user","message":{"role":"user","content":"<text>"}}`
- Session listing: `ls -t ~/.claude/projects/<projectHash>/*.jsonl`
- Native capabilities: planMode ✓, todoTracking ✓, resume ✓, stdin ✓

## Codex Provider Details

- Command: `codex exec --json "<prompt>"` or interactive mode
- Resume: `codex resume <sessionId>`
- Input: prompt as CLI argument (stdin not fully supported upstream)
- Session listing: scan `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` headers, filter by `cwd` field in `SessionMeta` record (first line of each file)
- Event types: `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`
- Item types: `agent_message`, `command_execution`, `file_change`, `todo_list`, `reasoning`, etc.
- Native capabilities: planMode ✗, todoTracking ✓ (todo_list item), resume ✓, stdin ✗

## File Structure

```
server/src/providers/
  ├── types.ts              # CLIProvider, ProviderCapabilities, OutputParser
  ├── registry.ts           # ProviderRegistry: register(), get()
  ├── claude/
  │   ├── index.ts          # ClaudeProvider implementation
  │   ├── parser.ts         # Migrated from stream-json-parser.ts
  │   └── transcript.ts     # Migrated from transcript-parser.ts
  └── codex/
      ├── index.ts          # CodexProvider implementation
      ├── parser.ts         # Codex NDJSON event parsing
      └── transcript.ts     # Codex rollout JSONL parsing

client/src/
  ├── lib/provider-colors.ts    # provider → bubble background color mapping
  └── components/chat/
      └── ProviderSwitcher.tsx  # Tool switch UI
```

## Affected Existing Files

| File | Change |
|------|--------|
| `server/src/ssh-manager.ts` | Remove hardcoded Claude commands; accept provider-built commands |
| `server/src/ws-handler.ts` | Route through provider based on session.provider; handle switch message |
| `server/src/db.ts` | `claudeSessionId` → `cliSessionId`; add `provider` field to sessions and messages |
| `client/src/stores/session-store.ts` | Add provider property to session |
| `client/src/stores/plan-mode-store.ts` | Check capabilities for native plan mode |
| `client/src/components/chat/MessageBubble.tsx` | Apply background color based on message provider |
| `client/src/components/chat/ToolActivityBlock.tsx` | Use normalized tool names for icon matching |

## Migration Strategy

1. Build provider abstraction layer + Claude provider (pure refactor, no behavior change)
2. Verify all existing features work correctly
3. Implement Codex provider
4. Implement tool switch flow (context compaction + injection)
5. Frontend adaptation (bubble colors, switch UI)
