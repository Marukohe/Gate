import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 1024 * 1024;
const activeStates = new Set(['starting', 'running', 'stopping']);

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw new Error('Expected an identifier containing 1-80 letters, digits, underscores, or hyphens');
  }
  return value;
}

function text(value, name) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`Invalid ${name}`);
  return value;
}

function append(file, event) {
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(event) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJournal(file) {
  const contents = fs.readFileSync(file, 'utf8');
  if (!contents.endsWith('\n')) throw new Error(`Incomplete journal; manual inspection required: ${file}`);
  return contents.trimEnd().split('\n').map((line) => JSON.parse(line));
}

export async function startRuntime(directory, { stopTimeoutMs = 1500 } = {}) {
  if (process.platform === 'win32') throw new Error('The P0 runtime requires Unix sockets and process groups');
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const socketPath = path.join(root, 'runtime.sock');
  if (Buffer.byteLength(socketPath) > 100) throw new Error('Runtime socket path is too long');
  const runs = new Map();
  const clients = new Set();
  let closing = false;
  let closePromise;

  function record(run, type, data = {}) {
    const event = { version: PROTOCOL_VERSION, runId: run.id, seq: run.seq + 1, time: Date.now(), type, ...data };
    append(run.file, event);
    run.seq = event.seq;
    return event;
  }

  function snapshot(run) {
    return { runId: run.id, state: run.state, seq: run.seq, exitCode: run.exitCode, signal: run.signal };
  }

  function getRun(id) {
    const run = runs.get(identifier(id));
    if (!run) throw new Error('Run not found');
    return run;
  }

  function signal(run, name) {
    // Only live children owned by this runtime may be signalled. Never use a PID recovered from disk.
    if (!run.child?.pid) return;
    try {
      process.kill(-run.child.pid, name);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }

  function interrupt(run) {
    if (!run.child || !activeStates.has(run.state) || run.state === 'stopping') return snapshot(run);
    record(run, 'stopping');
    run.state = 'stopping';
    signal(run, 'SIGTERM');
    run.killTimer = setTimeout(() => signal(run, 'SIGKILL'), stopTimeoutMs);
    return snapshot(run);
  }

  function start(request) {
    const id = identifier(request.runId);
    const command = text(request.command, 'command');
    const cwd = text(request.cwd, 'cwd');
    if (!path.isAbsolute(cwd)) throw new Error('cwd must be absolute');
    if (!Array.isArray(request.args) || request.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new Error('args must be an array of strings without NUL bytes');
    }
    const spec = { command, args: request.args, cwd };
    const existing = runs.get(id);
    if (existing) {
      if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) throw new Error('Run ID already has a different command');
      return snapshot(existing);
    }
    const file = path.join(root, `${id}.jsonl`);
    fs.closeSync(fs.openSync(file, 'wx', 0o600));
    const run = { id, file, spec, state: 'starting', seq: 0, inputs: new Map(), exitCode: null, signal: null };
    record(run, 'requested', { spec });
    runs.set(id, run);
    const child = spawn(command, request.args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    run.child = child;
    run.done = new Promise((resolve) => {
      child.on('spawn', () => {
        record(run, 'started');
        if (run.state !== 'stopping') run.state = 'running';
      });
      child.on('error', (error) => record(run, 'error', { message: error.message }));
      child.stdin.on('error', (error) => record(run, 'input-error', { message: error.message }));
      for (const stream of ['stdout', 'stderr']) {
        child[stream].setEncoding('utf8');
        child[stream].on('data', (data) => record(run, stream, { data }));
      }
      child.on('close', (code, exitSignal) => {
        clearTimeout(run.killTimer);
        record(run, 'exited', { exitCode: code, signal: exitSignal, interrupted: run.state === 'stopping' });
        run.state = 'exited';
        run.exitCode = code;
        run.signal = exitSignal;
        run.child = null;
        resolve();
      });
    });
    return snapshot(run);
  }

  function dispatch(request) {
    if (!request || request.version !== PROTOCOL_VERSION) throw new Error('Unsupported protocol version');
    if (request.method === 'ping') {
      return { version: PROTOCOL_VERSION, closing,
        capabilities: { stdio: true, replay: true, pty: false, approvals: false } };
    }
    if (closing) throw new Error('Runtime is shutting down');
    switch (request.method) {
      case 'list':
        return [...runs.values()].map(snapshot);
      case 'start':
        return start(request);
      case 'get':
        return snapshot(getRun(request.runId));
      case 'events': {
        const run = getRun(request.runId);
        const after = request.after ?? 0;
        const limit = request.limit ?? 100;
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
          throw new Error('Invalid event cursor or limit');
        }
        const events = readJournal(run.file).filter((event) => event.seq > after).slice(0, limit);
        return { events, next: events.at(-1)?.seq ?? after, more: (events.at(-1)?.seq ?? after) < run.seq };
      }
      case 'input': {
        const run = getRun(request.runId);
        const inputId = identifier(request.inputId);
        const data = text(request.data, 'input data');
        if (run.inputs.has(inputId)) {
          if (run.inputs.get(inputId) !== data) throw new Error('Input ID already has different data');
          return { accepted: true, duplicate: true };
        }
        if (!run.child || run.state !== 'running' || !run.child.stdin.writable) throw new Error('Run cannot accept input');
        // Acceptance is durable before delivery. A crash in between is ambiguous; never replay input automatically.
        record(run, 'input-accepted', { inputId, data });
        run.inputs.set(inputId, data);
        run.child.stdin.write(data);
        return { accepted: true, duplicate: false };
      }
      case 'interrupt':
        return interrupt(getRun(request.runId));
      case 'shutdown':
        setImmediate(() => void close());
        return { accepted: true };
      default:
        throw new Error('Unknown method');
    }
  }

  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(10_000, () => socket.destroy());
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    socket.on('data', (chunk) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) return socket.destroy();
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      let response;
      try {
        response = { ok: true, result: dispatch(JSON.parse(buffer.slice(0, newline))) };
      } catch (error) {
        response = { ok: false, error: error.message };
      }
      socket.end(JSON.stringify(response) + '\n');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);
  try {
    for (const name of fs.readdirSync(root).filter((name) => /^[a-zA-Z0-9_-]+\.jsonl$/.test(name))) {
      const file = path.join(root, name);
      const events = readJournal(file);
      const first = events[0];
      if (first?.type !== 'requested' || first.version !== PROTOCOL_VERSION) throw new Error(`Invalid journal: ${name}`);
      const last = events.at(-1);
      const run = {
        id: identifier(first.runId), file, spec: first.spec, seq: last.seq,
        state: last.type === 'exited' ? 'exited' : 'lost',
        exitCode: last.exitCode ?? null, signal: last.signal ?? null,
        inputs: new Map(events.filter((event) => event.type === 'input-accepted').map((e) => [e.inputId, e.data])),
      };
      runs.set(run.id, run);
      if (run.state === 'lost' && last.type !== 'lost') record(run, 'lost', { reason: 'Runtime ownership was lost' });
    }
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }

  async function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      for (const run of runs.values()) interrupt(run);
      await Promise.all([...runs.values()].map((run) => run.done));
      // Keep ping reachable until children have exited; socket disappearance then confirms shutdown has drained.
      const stopped = new Promise((resolve) => server.close(resolve));
      for (const socket of clients) socket.destroy();
      await stopped;
    })();
    return closePromise;
  }

  return { socketPath, close };
}

export function requestRuntime(directory, request, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(path.resolve(directory), 'runtime.sock'));
    let buffer = '';
    let settled = false;
    function finish(error, result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => finish(new Error('Runtime request timed out')));
    socket.on('error', (error) => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify({ version: PROTOCOL_VERSION, ...request }) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        finish(response.ok ? null : new Error(response.error), response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('close', () => finish(new Error('Runtime disconnected before responding')));
  });
}
