import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hookEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'];
const identity = (value) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new Error('Invalid hook scope');
  return value;
};
function save(file, value) {
  const temporary = `${file}.${randomUUID()}.new`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}

export function observations(directory) {
  const root = path.join(directory, 'observations');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const scopeFile = (id) => path.join(root, `${identity(id)}.scope.json`);
  const read = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return {
    configure({ scopeId, cwd, provider, enabled }) {
      if (!['claude', 'codex'].includes(provider) || typeof enabled !== 'boolean') throw new Error('Invalid hook configuration');
      const canonical = fs.realpathSync(cwd);
      const file = scopeFile(scopeId);
      const scope = read(file) ?? { scopeId, cwd: canonical, providers: {} };
      if (scope.cwd !== canonical) throw new Error('Hook scope belongs to another checkout');
      scope.providers[provider] = enabled;
      save(file, scope);
      return scope;
    },
    list(scopeId) {
      const scope = read(scopeFile(scopeId));
      const sessions = fs.readdirSync(root).filter((name) => name.startsWith(`${scopeId}-`) && name.endsWith('.session.json'))
        .map((name) => read(path.join(root, name)));
      return { scope, sessions };
    },
    observe({ scopeId, provider, sessionId, cwd, event }) {
      const scope = read(scopeFile(scopeId));
      if (!scope?.providers[provider]) throw new Error('Hook scope is disabled');
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200 || /[\x00-\x1f]/.test(sessionId)) {
        throw new Error('Invalid provider session ID');
      }
      if (!hookEvents.includes(event)) throw new Error('Unsupported hook event');
      if (fs.realpathSync(cwd) !== scope.cwd) throw new Error('Hook event belongs to another checkout');
      const id = createHash('sha256').update(JSON.stringify([scopeId, provider, sessionId])).digest('hex');
      const file = path.join(root, `${scopeId}-${id}.session.json`);
      const previous = read(file);
      const item = { id, scopeId, provider, sessionId, cwd: scope.cwd, event,
        state: event === 'SessionEnd' ? 'ended' : event === 'PermissionRequest' ? 'waiting'
          : ['Stop', 'SessionStart'].includes(event) ? 'idle' : 'busy',
        revision: (previous?.revision ?? 0) + 1, firstSeenAt: previous?.firstSeenAt ?? Date.now(), lastSeenAt: Date.now() };
      save(file, item);
      return item;
    },
  };
}
