import { spawn } from 'node:child_process';
import { captureSnapshot } from './snapshot.mjs';
import readline from 'node:readline';

const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.once('line', (line) => {
  input.close();
  process.stdin.destroy();
  try {
    const config = JSON.parse(line);
    const before = captureSnapshot(config.cwd);
    emit({ type: 'verification-started', command: config.command, cwd: config.cwd, before, startedAt: Date.now() });
    const child = spawn('/bin/sh', ['-c', config.command], { cwd: config.cwd, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GATE_MANAGED: '1',
        PATH: config.nodeDirectory ? `${config.nodeDirectory}:${process.env.PATH ?? '/usr/bin:/bin'}` : process.env.PATH } });
    child.on('error', (error) => emit({ type: 'result', failed: true, message: error.message }));
    for (const stream of ['stdout', 'stderr']) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (text) => emit({ type: 'test-output', stream, text }));
    }
    child.on('close', (exitCode, signal) => {
      let after = null;
      let snapshotError = null;
      try { after = captureSnapshot(config.cwd); } catch (error) { snapshotError = error.message; }
      emit({ type: 'verification-completed', after, exitCode, signal, endedAt: Date.now() });
      emit({ type: 'result', failed: exitCode !== 0 || !!snapshotError,
        message: snapshotError ?? (exitCode !== 0 ? `Command exited ${exitCode ?? signal}` : null) });
      process.exitCode = exitCode === 0 && !snapshotError ? 0 : 1;
    });
  } catch (error) {
    emit({ type: 'result', failed: true, message: error.message });
    process.exitCode = 1;
  }
});
