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
