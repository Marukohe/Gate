import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { createAdapter } from './provider.mjs';
import { captureSnapshot } from './snapshot.mjs';

const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
let child;
let adapter;
let failure = false;
let timer;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const fail = (error) => {
  failure = true;
  emit({ type: 'result', failed: true, message: error.message });
  if (child) child.stdin.end(); else { input.close(); process.stdin.destroy(); process.exitCode = 1; }
};
input.on('line', (line) => {
  let value;
  try {
    value = JSON.parse(line);
    if (adapter) { adapter.input(value); return; }
    if (!['claude', 'codex'].includes(value.provider)) throw new Error('Unsupported provider');
    const args = value.provider === 'codex' ? [...(value.readOnly
      ? ['--disable', 'hooks', '--disable', 'apps'] : []),
      'app-server', '--listen', 'stdio://'] :
      ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--permission-prompt-tool', 'stdio', ...(value.nativeSessionId ? ['--resume', value.nativeSessionId] : []),
        ...(value.readOnly ? ['--tools', 'Read,Glob,Grep', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
          '--disable-slash-commands', '--settings', '{"disableAllHooks":true}',
          ...(value.review?.patchPath ? ['--add-dir', path.dirname(value.review.patchPath)] : [])] : [])];
    child = spawn(value.executable, args, { cwd: value.cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ''}` } });
    child.stderr.pipe(process.stderr);
    child.on('error', fail);
    child.stdin.on('error', fail);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    adapter = createAdapter(value, (message) => child.stdin.write(JSON.stringify(message) + '\n'), emit, (failed) => {
      failure ||= failed;
      child.stdin.end();
      // An idle provider must exit before the runtime confirms completion.
      timer = setTimeout(() => { failure = true; child.kill('SIGTERM'); }, 10_000);
    });
    lines.on('line', (data) => { try { adapter.message(JSON.parse(data)); } catch (error) { fail(error); } });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (value.review) {
        try {
          const snapshot = captureSnapshot(value.cwd);
          if (snapshot.head !== value.review.commit || snapshot.tree !== value.review.tree) {
            throw new Error('The review checkout changed; this result is not a review of the fixed snapshot');
          }
          emit({ type: 'review-verified', snapshot });
        } catch (error) { failure = true; emit({ type: 'result', failed: true, message: error.message }); }
      }
      if (!adapter.isComplete()) emit({ type: 'result', failed: true, message: `Provider exited before a result (${code ?? signal})` });
      input.close();
      process.stdin.destroy();
      process.exitCode = failure || !adapter.isComplete() || code !== 0 ? 1 : 0;
    });
  } catch (error) {
    // Invalid user decisions do not end a provider that is still waiting for a valid answer.
    if (adapter) emit({ type: 'decision-error', id: String(value?.id), message: error.message }); else fail(error);
  }
});
