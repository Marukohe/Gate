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
