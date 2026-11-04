import { createInterface } from 'node:readline';

console.log(JSON.stringify({ type: 'ready' }));
let ticks = 0;
const timer = setInterval(() => console.log(JSON.stringify({ type: 'tick', value: ++ticks })), 100);
createInterface({ input: process.stdin }).on('line', (line) => {
  console.log(JSON.stringify({ type: 'echo', value: line }));
  if (line === 'exit') {
    clearInterval(timer);
    process.exit(0);
  }
});
