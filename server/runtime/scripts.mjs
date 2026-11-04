import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function readScripts(cwd) {
  try {
    const file = path.join(cwd, 'gate.json');
    if (fs.statSync(file).size > 100_000) throw new Error('gate.json exceeds 100 KB');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('gate.json must be an object');
    const scripts = config.scripts ?? {};
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) throw new Error('gate.json scripts must be an object');
    const result = {};
    for (const name of ['setup', 'run', 'test']) {
      const command = scripts[name];
      if (command === undefined) continue;
      if (typeof command !== 'string' || command.includes('\0')) throw new Error(`gate.json scripts.${name} must be a command string`);
      if (command.trim()) result[name] = { command, source: 'gate.json' };
    }
    return { scripts: result, warning: null };
  } catch (error) {
    return { scripts: {}, warning: error.code === 'ENOENT' ? null : `Cannot read repository scripts: ${error.message}` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  console.log(JSON.stringify(readScripts(JSON.parse(data).cwd)));
}
