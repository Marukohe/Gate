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

  buildCommand(opts: { resumeSessionId?: string; workingDir?: string; initialContext?: string }): string {
    const resumeFlag = opts.resumeSessionId ? ` --resume '${opts.resumeSessionId}'` : '';
    const cdPrefix = opts.workingDir ? `${shellCd(opts.workingDir)} && ` : '';
    return `$SHELL -lc "${cdPrefix}claude -p${resumeFlag} ${CLAUDE_BASE_ARGS}"`;
  }

  formatInput(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
  }

  requestSummary(): string {
    return 'Please summarize the current conversation context in under 500 words. Include: the goal of this session, key decisions made, current progress, and any pending tasks or open questions.';
  }

  createParser(): OutputParser {
    return new ClaudeStreamParser();
  }

  extractSessionId(event: ParsedMessage): string | null {
    if (event.type === 'system' && event.subType === 'init') {
      const match = event.content.match(/\(([^)]+)\)/);
      return match?.[1] ?? null;
    }
    return null;
  }

  normalizeToolName(rawName: string): string {
    return rawName;
  }

  async listRemoteSessions(runCommand: SSHExec, workingDir: string): Promise<RemoteSession[]> {
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
    const { stdout: filePath } = await runCommand(`ls ~/.claude/projects/*/${sessionId}.jsonl 2>/dev/null | head -1`);
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return [];
    const { stdout: jsonlContent } = await runCommand(`cat '${trimmedPath}'`);
    return parseClaudeTranscript(jsonlContent);
  }

  getCapabilities(): ProviderCapabilities {
    return { nativePlanMode: true, nativeTodoTracking: true, supportsResume: true, supportsStdin: true };
  }
}
