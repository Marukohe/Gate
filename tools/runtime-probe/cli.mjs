import { setTimeout as delay } from 'node:timers/promises';
import { startRuntime, requestRuntime } from './runtime.mjs';

const [command, directory, runId, after = '0'] = process.argv.slice(2);
process.stdout.on('error', () => process.exit(1));
try {
  if (!directory || !['serve', 'request', 'watch'].includes(command)) {
    throw new Error('Usage: node cli.mjs <serve|request|watch> <directory> [runId] [after]; request reads JSON from stdin');
  }
  if (command === 'serve') {
    const runtime = await startRuntime(directory);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void runtime.close());
    console.log(JSON.stringify({ ready: true, socket: runtime.socketPath }));
  } else if (command === 'watch') {
    let cursor = Number(after);
    while (true) {
      const page = await requestRuntime(directory, { method: 'events', runId, after: cursor });
      for (const event of page.events) console.log(JSON.stringify(event));
      cursor = page.next;
      const run = await requestRuntime(directory, { method: 'get', runId });
      if (['exited', 'lost'].includes(run.state) && cursor >= run.seq) break;
      if (!page.more) await delay(100);
    }
  } else {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
      if (Buffer.byteLength(data) > 1024 * 1024) throw new Error('Request is too large');
    }
    console.log(JSON.stringify(await requestRuntime(directory, JSON.parse(data))));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
