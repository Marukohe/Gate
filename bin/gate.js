#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { installedVersion, update } from './update.js';

const { values, positionals } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '3030' },
    host: { type: 'string', short: 'h', default: '0.0.0.0' },
    'data-dir': { type: 'string', short: 'd' },
    help: { type: 'boolean', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Usage: gate [options]
       gate update

Commands:
  update                  Install the latest Gate release from GitHub

Options:
  -p, --port <port>        Port to listen on (default: 3030)
  -h, --host <host>        Host to bind to (default: 0.0.0.0)
  -d, --data-dir <path>    Data directory for database (default: ~/.gate)
  -v, --version           Show the installed version
      --help               Show this help message
`);
  process.exit(0);
}

if (values.version) {
  console.log(installedVersion());
} else if (positionals[0] === 'update') {
  try {
    await update();
  } catch (error) {
    console.error(`Gate update failed: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  process.env.PORT = values.port;
  process.env.HOST = values.host;
  if (values['data-dir']) {
    process.env.GATE_DATA_DIR = values['data-dir'];
  }

  await import(new URL('../server/dist/index.js', import.meta.url).href);
}
