import { execFile } from 'node:child_process';
import { access, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { SshHost } from './types.js';

const exec = promisify(execFile);
const validAlias = (alias: string) => /^[a-z\d][a-z\d_.:-]{0,254}$/i.test(alias);

// Only discover concrete Host names here. OpenSSH evaluates precedence, defaults and Match blocks.
function words(line: string) {
  const result: string[] = []; let word = '', quoted = false, escaped = false;
  for (const c of line) {
    if (escaped) { word += c; escaped = false; }
    else if (c === '\\') escaped = true;
    else if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted) break;
    else if (/\s/.test(c) && !quoted) { if (word) result.push(word); word = ''; }
    else word += c;
  }
  if (word) result.push(word);
  return result;
}

function pattern(value: string) {
  let source = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '*') source += '.*';
    else if (c === '?') source += '.';
    else if (c === '[' && value.indexOf(']', i + 1) > i + 1) {
      const end = value.indexOf(']', i + 1);
      source += '[' + value.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']'; i = end;
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

async function expand(path: string): Promise<string[]> {
  if (!/[*?[]/.test(path)) return [path];
  let paths = [parse(path).root];
  for (const part of path.slice(parse(path).root.length).split('/')) {
    if (!/[*?[]/.test(part)) { paths = paths.map((base) => join(base, part)); continue; }
    const matcher = pattern(part); const next: string[] = [];
    for (const base of paths) {
      const entries = await readdir(base).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
        throw error;
      });
      next.push(...entries.filter((name) => matcher.test(name) && (!name.startsWith('.') || part.startsWith('.'))).map((name) => join(base, name)));
      if (next.length > 256) throw new Error('Too many SSH Include files');
    }
    paths = next;
  }
  return paths.sort();
}

export async function listSshHosts(configFile = join(homedir(), '.ssh/config')): Promise<string[]> {
  const hosts = new Set<string>(), visited = new Set<string>(); let bytes = 0;
  const visit = async (file: string) => {
    let path: string;
    try { path = await realpath(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (visited.has(path)) return;
    visited.add(path); if (visited.size > 64) throw new Error('Too many SSH Include files');
    const content = await readFile(path, 'utf8'); bytes += Buffer.byteLength(content);
    if (bytes > 1024 * 1024) throw new Error('SSH configuration exceeds 1 MB');
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*(\w+)(?:\s*=\s*|\s+)(.*)$/.exec(line); if (!match) continue;
      const values = words(match[2]);
      if (match[1].toLowerCase() === 'host') for (const alias of values) { if (validAlias(alias)) hosts.add(alias); }
      if (hosts.size > 500) throw new Error('Too many SSH hosts');
      if (match[1].toLowerCase() === 'include') for (const value of values) {
        const expanded = value.replace(/^~(?=\/)/, homedir()).replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
        const included = isAbsolute(expanded) ? expanded : resolve(dirname(configFile), expanded);
        for (const file of await expand(included)) await visit(file);
      }
    }
  };
  await visit(configFile); return [...hosts].sort((a, b) => a.localeCompare(b));
}

export async function resolveSshHost(alias: string, configFile?: string): Promise<SshHost> {
  if (!validAlias(alias) || !(await listSshHosts(configFile)).includes(alias)) throw new Error('Choose a host from the local SSH configuration');
  let stdout: string;
  try { ({ stdout } = await exec('ssh', ['-G', '-T', ...(configFile ? ['-F', configFile] : []), alias], { timeout: 5000, maxBuffer: 1024 * 1024 })); }
  catch { throw new Error('Could not resolve this host. Check the SSH configuration on the machine running Gate.'); }
  const options = new Map<string, string[]>();
  for (const line of stdout.split('\n')) {
    const space = line.indexOf(' '); if (space < 1) continue;
    const key = line.slice(0, space); options.set(key, [...(options.get(key) ?? []), line.slice(space + 1).trim()]);
  }
  const value = (key: string) => options.get(key)?.[0];
  // Import editable direct-connection fields, never silently discard a required proxy or certificate.
  if (['proxyjump', 'proxycommand', 'certificatefile', 'pkcs11provider'].some((key) => value(key) && value(key) !== 'none')) {
    throw new Error('This host requires a proxy or certificate that Gate cannot import. Use a direct connection in manual settings.');
  }
  const host = value('hostname') ?? alias, username = value('user') ?? '', port = Number(value('port'));
  if (!username || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid resolved SSH connection');
  const identityFiles: string[] = [];
  for (const file of options.get('identityfile') ?? []) {
    if (file === 'none') continue;
    const tokens: Record<string, string> = { '%': '%', d: homedir(), u: process.env.USER ?? '', h: host, r: username, p: String(port), n: alias };
    const path = file.replace(/^~(?=\/)/, homedir()).replace(/%([%duhrpn])/g, (_, token: string) => tokens[token])
      .replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
    try { await access(path); identityFiles.push(resolve(path)); } catch { /* OpenSSH also skips missing default identities. */ }
  }
  return { alias, host, port, username, identityFiles };
}

export const sshHosts = { list: listSshHosts, resolve: resolveSshHost };
