import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listSshHosts, resolveSshHost } from '../ssh-config.js';

let dir: string, config: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'gate-ssh-config-')); config = join(dir, 'config'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('discovers concrete aliases across includes, ignores patterns and comments, and bounds include cycles', async () => {
  await mkdir(join(dir, 'hosts with spaces'));
  await writeFile(config, 'Host first second # not-a-host\nHost * !excluded dev-?\nInclude "hosts with spaces/[ab]*.conf"\n');
  await writeFile(join(dir, 'hosts with spaces/a.conf'), 'hOsT = "included" first\nInclude config\n');
  await writeFile(join(dir, 'hosts with spaces/b.conf'), 'Host last\n');
  await writeFile(join(dir, 'hosts with spaces/c.conf'), 'Host not-included\n');
  expect(await listSshHosts(config)).toEqual(['first', 'included', 'last', 'second']);
  expect(await listSshHosts(join(dir, 'missing'))).toEqual([]);
});

it('imports OpenSSH-resolved fields with defaults and includes, never reads or returns key contents', async () => {
  const key = join(dir, 'private key'); await writeFile(key, 'private-key-marker');
  const included = join(dir, 'included.conf');
  await writeFile(included, `Host actual alias\n HostName 127.0.0.1\n User fixture\n Port 22022\n IdentityFile "${key}"\n`);
  const original = `Include "${included}"\nHost *\n User fallback\n Port 22\n IdentityFile "${dir}/missing"\n`;
  await writeFile(config, original);
  const host = await resolveSshHost('alias', config);
  expect(host).toEqual({ alias: 'alias', host: '127.0.0.1', username: 'fixture', port: 22022, identityFiles: [key] });
  expect(JSON.stringify(host)).not.toContain('private-key-marker'); expect(await readFile(config, 'utf8')).toBe(original);
  await expect(resolveSshHost('-oProxyCommand=bad', config)).rejects.toThrow('Choose a host');
  await expect(resolveSshHost('absent', config)).rejects.toThrow('Choose a host');
});

it('does not silently turn proxy or certificate configurations into direct connections', async () => {
  await writeFile(config, 'Host relay\n HostName private.local\n ProxyJump jump.local\nHost certified\n CertificateFile ~/.ssh/certificate.pub\n');
  await expect(resolveSshHost('relay', config)).rejects.toThrow('proxy or certificate');
  await expect(resolveSshHost('certified', config)).rejects.toThrow('proxy or certificate');
});
