#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p', default: '3001' },
    host: { type: 'string', short: 'h', default: '0.0.0.0' },
    'data-dir': { type: 'string', short: 'd' },
    help: { type: 'boolean', default: false },
  },
  strict: false,
});

if (values.help) {
  console.log(`
Usage: gate [options]

Options:
  -p, --port <port>        Port to listen on (default: 3001)
  -h, --host <host>        Host to bind to (default: 0.0.0.0)
  -d, --data-dir <path>    Data directory for database (default: ~/.gate)
      --help               Show this help message
`);
  process.exit(0);
}

process.env.PORT = values.port;
process.env.HOST = values.host;
if (values['data-dir']) {
  process.env.GATE_DATA_DIR = values['data-dir'];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(__dirname, '..', 'server', 'dist', 'index.js'));
