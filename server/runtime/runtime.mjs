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
  const bytes = Buffer.from(JSON.stringify(event) + '\n');
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return bytes.length;
}

function readPage(run, after, limit) {
  if (after < 0 || after >= run.seq || limit <= 0) return [];
  const start = run.offsets[after];
  if (start === undefined) return [];
  const end = run.offsets[Math.min(after + limit, run.seq)] ?? run.bytes;
  const buffer = Buffer.alloc(end - start);
  const fd = fs.openSync(run.file, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, start); } finally { fs.closeSync(fd); }
  return buffer.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
}

export async function startRuntime(directory, { stopTimeoutMs = 1500, maxJournalBytes = 64 * 1024 * 1024 } = {}) {
  if (process.platform === 'win32') throw new Error('The runtime requires Unix sockets and process groups');
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
    run.offsets.push(run.bytes);
    run.bytes += append(run.file, event);
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
    const initialInput = request.initialInput ?? '';
    if (typeof initialInput !== 'string' || Buffer.byteLength(initialInput) > MAX_REQUEST_BYTES / 2) {
      throw new Error('Invalid initial input');
    }
    const spec = { command, args: request.args, cwd,
      ...(initialInput ? { initialInput } : {}), ...(request.protocol === true ? { protocol: true } : {}) };
    const existing = runs.get(id);
    if (existing) {
      if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) throw new Error('Run ID already has a different command');
      return snapshot(existing);
    }
    const file = path.join(root, `${id}.jsonl`);
    fs.closeSync(fs.openSync(file, 'wx', 0o600));
    const run = { id, file, spec, state: 'starting', seq: 0, bytes: 0, offsets: [],
      inputs: new Map(), exitCode: null, signal: null };
    record(run, 'requested', { spec });
    runs.set(id, run);
    const child = spawn(command, request.args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    run.child = child;
    run.done = new Promise((resolve) => {
      child.on('spawn', () => {
        record(run, 'started');
        if (run.state !== 'stopping') run.state = 'running';
        if (initialInput) child.stdin.write(initialInput);
      });
      child.on('error', (error) => record(run, 'error', { message: error.message }));
      child.stdin.on('error', (error) => record(run, 'input-error', { message: error.message }));
      for (const stream of ['stdout', 'stderr']) {
        let partial = '';
        child[stream].setEncoding('utf8');
        child[stream].on('data', (data) => {
          if (run.outputStopped) return;
          if (run.bytes + Buffer.byteLength(data) * 6 > maxJournalBytes) {
            run.outputStopped = true;
            record(run, 'error', { message: 'Run output exceeded the journal limit' });
            interrupt(run);
            return;
          }
          if (stream !== 'stdout' || !spec.protocol) { record(run, stream, { data }); return; }
          partial += data;
          if (Buffer.byteLength(partial) > 512 * 1024) {
            run.outputStopped = true;
            record(run, 'error', { message: 'Provider protocol line exceeded the size limit' });
            interrupt(run);
            return;
          }
          let newline;
          while ((newline = partial.indexOf('\n')) >= 0) {
            const line = partial.slice(0, newline);
            partial = partial.slice(newline + 1);
            let parsed;
            try { parsed = JSON.parse(line); }
            catch { record(run, 'error', { message: `Invalid provider output: ${line}` }); continue; }
            record(run, 'protocol', { data: parsed });
          }
        });
        child[stream].on('end', () => {
          if (partial && !run.outputStopped) record(run, 'error', { message: 'Provider output ended mid-message' });
        });
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
        // Limit bytes as well as event count; replay never rereads the whole journal.
        let count = Math.min(limit, run.seq - after);
        while (count > 1 && (run.offsets[after + count] ?? run.bytes) - run.offsets[after] > 1024 * 1024) count--;
        const events = readPage(run, after, count);
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
        if (run.bytes + Buffer.byteLength(data) * 6 + 1024 > maxJournalBytes) throw new Error('Run journal limit reached');
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
      const indexed = { file, offsets: [], bytes: fs.statSync(file).size };
      const fd = fs.openSync(file, 'r');
      let offset = 0;
      let partial = Buffer.alloc(0);
      let position = 0;
      try {
        const chunk = Buffer.alloc(64 * 1024);
        let size;
        while ((size = fs.readSync(fd, chunk, 0, chunk.length, position)) > 0) {
          position += size;
          partial = Buffer.concat([partial, chunk.subarray(0, size)]);
          let newline;
          while ((newline = partial.indexOf(10)) >= 0) {
            indexed.offsets.push(offset);
            offset += newline + 1;
            partial = partial.subarray(newline + 1);
          }
          if (partial.length > MAX_REQUEST_BYTES * 4) throw new Error(`Oversized journal entry: ${name}`);
        }
        if (partial.length) throw new Error(`Incomplete journal; manual inspection required: ${file}`);
      } finally { fs.closeSync(fd); }
      indexed.seq = indexed.offsets.length;
      const first = readPage(indexed, 0, 1)[0];
      const last = readPage(indexed, indexed.seq - 1, 1)[0];
      if (first?.type !== 'requested' || first.version !== PROTOCOL_VERSION) throw new Error(`Invalid journal: ${name}`);
      if (name !== `${first.runId}.jsonl`) throw new Error(`Journal run ID does not match filename: ${name}`);
      const run = {
        ...indexed, id: identifier(first.runId), spec: first.spec,
        state: last.type === 'exited' ? 'exited' : 'lost',
        exitCode: last.exitCode ?? null, signal: last.signal ?? null,
        inputs: new Map(), validatedSeq: 0,
      };
      for (let after = 0; after < run.seq; after += 50) {
        for (const event of readPage(run, after, 50)) {
          if (event.runId !== run.id || event.seq !== ++run.validatedSeq) throw new Error(`Invalid journal sequence: ${name}`);
          if (event.type === 'input-accepted') run.inputs.set(event.inputId, event.data);
        }
      }
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
