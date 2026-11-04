import readline from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { requestRuntime } from './runtime.mjs';

const [directory, runId, initialCursor = '0'] = process.argv.slice(2);
let cursor = Number(initialCursor);
let closed = false;
let queue = Promise.resolve();
let queued = 0;
let lastState;
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
process.stdout.on('error', () => process.exit(0));
const input = readline.createInterface({ input: process.stdin });
input.on('close', () => { closed = true; });
input.on('line', (line) => {
  if (line.length > 40000 || queued >= 64) { process.exitCode = 1; input.close(); return; }
  queued++;
  queue = queue.then(async () => {
    let request;
    try {
      request = JSON.parse(line);
      const result = await requestRuntime(directory, { method: 'input', runId, inputId: request.id,
        data: JSON.stringify(request.message) + '\n', redact: true });
      emit({ type: 'ack', id: request.id, result });
    } catch (error) { emit({ type: 'input-error', id: request?.id, message: error.message }); }
    finally { queued--; }
  });
});
try {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid terminal cursor');
  while (!closed) {
    const page = await requestRuntime(directory, { method: 'events', runId, after: cursor, limit: 100 });
    if (page.events.length) emit({ type: 'events', events: page.events });
    cursor = page.next;
    if (!page.more) {
      const run = await requestRuntime(directory, { method: 'get', runId });
      if (run.state !== lastState) emit({ type: 'ready', cursor, state: run.state });
      lastState = run.state;
      if (['exited', 'lost'].includes(run.state)) break;
      await delay(100);
    }
  }
} catch (error) { emit({ type: 'connection-error', message: error.message }); process.exitCode = 1; }
finally { input.close(); process.stdin.destroy(); await queue; }
