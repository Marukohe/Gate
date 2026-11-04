import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hookEvents } from './observations.mjs';

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export function installHooks({ cwd, scopeId, provider, enabled, directory, nodePath, hookPath }) {
  if (!['claude', 'codex'].includes(provider) || !/^[a-zA-Z0-9_-]{1,80}$/.test(scopeId) || typeof enabled !== 'boolean') {
    throw new Error('Invalid hook installation');
  }
  const file = path.join(cwd, provider === 'claude' ? '.claude/settings.local.json' : '.codex/hooks.json');
  const marker = ` # gate-observer:${scopeId}:${provider}`;
  const command = [nodePath, hookPath, directory, scopeId, provider].map(quote).join(' ') + marker;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.realpathSync(path.dirname(file)) !== path.join(fs.realpathSync(cwd), `.${provider}`) ||
    (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())) {
    throw new Error('Scoped hooks require a checkout-local configuration file, not a symlink');
  }
  // Do not overwrite a concurrent settings writer or remove a stale lock based on an old PID.
  const lock = `${file}.gate-lock`;
  fs.mkdirSync(lock);
  try {
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const config = original === null ? {} : JSON.parse(original);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Hook configuration must be an object');
    config.hooks ??= {};
    if (typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error('Invalid hooks configuration');
    for (const [event, groups] of Object.entries(config.hooks)) {
      if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group?.hooks))) throw new Error('Invalid hook groups');
      config.hooks[event] = groups.flatMap((group) => {
        const hooks = group.hooks.filter((hook) => !(typeof hook.command === 'string' && hook.command.endsWith(marker)));
        return hooks.length ? [{ ...group, hooks }] : [];
      });
    }
    if (enabled) for (const event of hookEvents) {
      (config.hooks[event] ??= []).push({ hooks: [{ type: 'command', command, timeout: 2 }] });
    }
    const content = JSON.stringify(config, null, 2) + '\n';
    if (content !== original) {
      const backups = path.join(directory, 'hook-backups');
      fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
      if (original !== null) fs.writeFileSync(path.join(backups, `${scopeId}-${provider}-${randomUUID()}.json`), original, { mode: 0o600 });
      if ((fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) !== original) throw new Error('Hook settings changed; retry installation');
      const temporary = `${file}.${randomUUID()}.new`;
      fs.writeFileSync(temporary, content, { mode: original === null ? 0o600 : fs.statSync(file).mode & 0o777 });
      fs.renameSync(temporary, file);
    }
    return { file, command, enabled, needsTrust: enabled && provider === 'codex' };
  } finally { fs.rmdirSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    console.log(JSON.stringify(installHooks(JSON.parse(data))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
