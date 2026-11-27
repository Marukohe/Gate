import { posix } from 'node:path';
import type { Client } from 'ssh2';
import { execRemote, quote } from '../ssh.js';

interface Executable {
  file: string;
  path: string;
}

const shell = (script: string, interactive = false) =>
  `"$SHELL" ${interactive ? '-ilc' : '-lc'} ${quote(`sh -c ${quote(script)}`)}`;

async function lookup(ssh: Client, names: string[], interactive: boolean) {
  const checks = names.map((name, index) =>
    `file=$(command -v ${quote(name)}) && [ -f "$file" ] && [ -x "$file" ] && printf 'gate-tool-${index}:%s\\0' "$file"`);
  // A fresh sh ignores aliases and functions. NUL framing separates lookup results from shell startup banners.
  const script = `printf '\\0gate-path:%s\\0' "$PATH"\n${checks.join(' || :\n')} || :`;
  const output = await execRemote(ssh, shell(script, interactive), interactive ? 5_000 : 10_000);
  const records = new Map(output.split('\0').filter((record) => record.startsWith('gate-')).map((record) => {
    const separator = record.indexOf(':');
    return [record.slice(0, separator), record.slice(separator + 1)] as const;
  }));
  const path = records.get('gate-path');
  const result = new Map<string, Executable>();
  if (path !== undefined) {
    names.forEach((name, index) => {
      const file = records.get(`gate-tool-${index}`);
      if (file) result.set(name, { file, path });
    });
  }
  return result;
}

export async function resolveTools(ssh: Client, names: string[]) {
  if (!names.length) return new Map<string, Executable>();
  const found = await lookup(ssh, names, false);
  const missing = names.filter((name) => !found.has(name) && !name.startsWith('/'));
  if (missing.length) {
    // Keep the login results when an interactive shell requires a terminal or fails to initialize.
    const fallback = await lookup(ssh, missing, true).catch(() => new Map<string, Executable>());
    for (const [name, executable] of fallback) found.set(name, executable);
  }
  return found;
}

export async function resolveTool(ssh: Client, name: string) {
  const found = (await resolveTools(ssh, [name])).get(name);
  if (found) return found;
  throw new Error(`Could not find an executable for "${name}" on the remote SSH account. Set its absolute path in server settings.`);
}

export function toolCommand(executable: Executable, args: string[]) {
  // Carry the selected PATH into a non-interactive launch, including runtimes such as Node.
  const path = quote(`${posix.dirname(executable.file)}:${executable.path}`);
  return shell(`export PATH=${path}\nexec ${[executable.file, ...args].map(quote).join(' ')}`);
}
