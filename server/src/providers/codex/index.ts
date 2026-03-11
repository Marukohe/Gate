import type {
  CLIProvider,
  SSHExec,
  OutputParser,
  ParsedMessage,
  RemoteSession,
  ProviderCapabilities,
} from '../types.js';
import { CodexStreamParser } from './parser.js';
import { parseCodexTranscript } from './transcript.js';
import { normalizeCodexToolName } from './tool-utils.js';

function shellCd(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) return `cd $HOME${dir.slice(1)}`;
  return `cd '${dir}'`;
}

function shellPrompt(prompt: string): { envPrefix: string; arg: string } {
  // Base64-encode to safely pass arbitrary text through two shell levels
  // (sshd shell -> $SHELL -lc). Base64 only contains [A-Za-z0-9+/=].
  const b64 = Buffer.from(prompt).toString('base64');
  return {
    envPrefix: `export GATE_CTX='${b64}' && `,
    arg: ` \\"\\$(printf '%s' \\$GATE_CTX | base64 -d)\\"`,
  };
}

export class CodexProvider implements CLIProvider {
  readonly name = 'codex';

  buildCommand(opts: {
    resumeSessionId?: string;
    workingDir?: string;
    initialContext?: string;
  }): string {
    const cdPrefix = opts.workingDir
      ? `${shellCd(opts.workingDir)} && `
      : '';
    const prompt = opts.initialContext ? shellPrompt(opts.initialContext) : null;

    if (opts.resumeSessionId) {
      return `$SHELL -lc "${prompt?.envPrefix ?? ''}${cdPrefix}codex exec --json resume '${opts.resumeSessionId}'${prompt?.arg ?? ''}"`;
    }
    if (opts.initialContext) {
      return `$SHELL -lc "${prompt!.envPrefix}${cdPrefix}codex exec --json --full-auto${prompt!.arg}"`;
    }
    return `$SHELL -lc "${cdPrefix}codex exec --json --full-auto \\"You are ready. Wait for instructions.\\""`;
  }

  formatInput(text: string): string {
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
    return normalizeCodexToolName(rawName);
  }

  async listRemoteSessions(
    runCommand: SSHExec,
    workingDir: string,
  ): Promise<RemoteSession[]> {
    const dir = workingDir.startsWith('~/')
      ? `$HOME/${workingDir.slice(2)}`
      : workingDir;
    const { stdout: resolved } = await runCommand(
      `cd "${dir}" 2>/dev/null && pwd || echo "${dir}"`,
    );
    const absPath = resolved.trim();

    const { stdout } = await runCommand(
      `find ~/.codex/sessions -name 'rollout-*.jsonl' -type f 2>/dev/null | sort -r | head -20`,
    );
    const files = stdout
      .trim()
      .split('\n')
      .filter(Boolean);

    const sessions: RemoteSession[] = [];
    for (const file of files) {
      const { stdout: head } = await runCommand(`head -1 '${file}'`);
      try {
        const meta = JSON.parse(head.trim());
        const payload = meta.payload ?? meta;
        if (payload.cwd && payload.cwd === absPath) {
          sessions.push({
            id:
              payload.id ??
              file
                .split('/')
                .pop()
                ?.replace('.jsonl', '') ??
              '',
            timestamp: meta.timestamp
              ? new Date(meta.timestamp).getTime()
              : undefined,
            label: payload.id,
          });
        }
      } catch {
        continue;
      }
    }
    return sessions;
  }

  async syncTranscript(
    runCommand: SSHExec,
    sessionId: string,
  ): Promise<ParsedMessage[]> {
    const { stdout: filePath } = await runCommand(
      `grep -rl '"${sessionId}"' ~/.codex/sessions/ 2>/dev/null | head -1`,
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
