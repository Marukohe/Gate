import { Router } from 'express';
import { availableDirectories, excludedDirectories, visibleSessions } from './visibility.js';
import type { Database } from './db.js';
import { publicServer } from './db.js';
import type { AgentService } from './agents.js';
import type { Server } from './types.js';
import { previewSessionFile, sendSessionFile } from './session-files.js';
import { sshHosts } from './ssh-config.js';
import { discoverTools } from './tool-discovery.js';

function text(value: unknown, name: string, max = 200_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function filePath(value: unknown): string {
  // Preserve whitespace in filenames; SFTP paths are not shell commands.
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Invalid file path');
  return value;
}
export function routes(db: Database, agents: AgentService, hosts = sshHosts, discover = discoverTools) {
  const router = Router();
  const sync = () => agents.sync(db.listServers().filter((server) => server.tool !== 'ssh'));
  sync();
  router.get('/tools', (_req, res) => res.json({ tools: agents.tools() }));
  router.get('/ssh/hosts', async (_req, res) => res.json({ hosts: await hosts.list() }));
  router.get('/ssh/hosts/:alias', async (req, res) => res.json(await hosts.resolve(req.params.alias)));
  router.get('/health', (_req, res) => res.json({ status: 'ok' }));
  router.get('/servers', (_req, res) => res.json(db.listServers().map(publicServer)));
  router.get('/servers/:id/models', async (req, res) => res.json({ models: await agents.models(req.params.id, typeof req.query.session === 'string' ? req.query.session : undefined) }));
  const sshSettings = (body: any, existing?: Server) => {
    const port = Number(body.port ?? 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
    if (!['password', 'privateKey'].includes(body.authType)) throw new Error('Invalid authentication method');
    return { name: text(body.name, 'name', 200), host: text(body.host, 'host', 500), username: text(body.username, 'username', 200),
      port, authType: body.authType as Server['authType'], password: body.password || existing?.password || '',
      privateKeyPath: body.privateKeyPath ? text(body.privateKeyPath, 'key path', 4096) : '' };
  };
  const settings = (body: any, existing?: Server) => {
    const toolId = body.tool ?? existing?.tool ?? 'codex';
    const tool = agents.tools().find((tool) => tool.id === toolId);
    if (!tool) throw new Error('Unsupported tool');
    if (existing && toolId !== (existing.tool || 'codex')) throw new Error('Add a separate connection for another tool.');
    const executable = body.executablePath ?? body.codexPath ?? existing?.executablePath ?? tool.executable;
    return { ...sshSettings(body, existing),
      defaultWorkingDir: body.defaultWorkingDir === undefined ? existing?.defaultWorkingDir : body.defaultWorkingDir ? text(body.defaultWorkingDir, 'directory', 4096) : '',
      tool: tool.id, executablePath: text(executable, 'tool executable', 4096),
      codexPath: tool.id === 'codex' ? text(executable, 'tool executable', 4096) : '' };
  };
  async function saveAccount(body: any, existing?: Server) {
    const ssh = sshSettings(body, existing);
    const children = existing ? db.listServers().filter((server) => server.sshAccountId === existing.id) : [];
    const overrides = new Map<string, string>();
    const manual = new Map<string, string>();
    const tools = agents.tools();
    for (const tool of tools) {
      const value = body.executables?.[tool.id];
      if (value === undefined) continue;
      const executable = value === '' ? tool.executable : text(value, 'tool executable', 4096);
      if (executable !== tool.executable && !executable.startsWith('/')) throw new Error(`Use an absolute path for ${tool.name}.`);
      if (value) manual.set(tool.id, executable);
      for (const child of children.filter((server) => server.tool === tool.id)) overrides.set(child.id, executable);
    }
    const detected = await discover(ssh, tools);
    const executables = new Map(tools.filter((tool) => detected.includes(tool.id)).map((tool) => [tool.id, tool.executable]));
    for (const [tool, executable] of manual) executables.set(tool, executable);
    const account = db.saveSshAccount(ssh, executables, existing?.id, overrides);
    sync();
    return publicServer(account);
  }
  router.post('/ssh/accounts', async (req, res) => res.status(201).json(await saveAccount(req.body)));
  router.put('/ssh/accounts/:id', async (req, res) => {
    const account = db.getServer(req.params.id);
    if (account?.tool !== 'ssh') return res.status(404).json({ error: 'SSH account not found' });
    res.json(await saveAccount(req.body, account));
  });
  router.post('/servers', (req, res) => { const server = db.createServer(settings(req.body)); sync(); res.status(201).json(publicServer(server)); });
  router.put('/servers/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    db.updateServer(server.id, settings(req.body, server)); sync(); res.json(publicServer(db.getServer(server.id)!));
  });
  router.delete('/servers/:id', (req, res) => { db.deleteServer(req.params.id); sync(); res.sendStatus(204); });
  router.get('/monitor', (_req, res) => {
    const snapshot = agents.monitor();
    const accounts = db.listServers().filter((server) => server.tool === 'ssh').map(({ id, name, host, port, username, createdAt }) =>
      ({ id, name, host, port, username, createdAt, tool: 'ssh', state: 'connected', sessions: [], hasMore: false }));
    res.json({ servers: [...accounts, ...snapshot.servers.map((server) => {
      const visibility = db.getVisibility(server.id);
      return { ...server, sessions: visibleSessions(server.sessions, visibility),
        hasFilters: visibility.excludedDirectories.length > 0 || visibility.archivedSessions.length > 0 };
    })] });
  });
  router.use('/servers/:id/visibility', (req, res, next) => {
    if (!db.getServer(req.params.id)) return res.status(404).json({ error: 'Server not found' });
    next();
  });
  router.get('/servers/:id/visibility', (req, res) => {
    const settings = db.getVisibility(req.params.id);
    const sessions = agents.monitor().servers.find((server) => server.id === req.params.id)?.sessions ?? [];
    res.json({ ...settings, directories: availableDirectories(sessions, settings) });
  });
  router.put('/servers/:id/visibility', (req, res) => {
    db.setExcludedDirectories(req.params.id, excludedDirectories(req.body.excludedDirectories));
    res.json(db.getVisibility(req.params.id));
  });
  router.post('/servers/:id/sessions/:thread/archive', (req, res) => {
    if (!db.getServer(req.params.id)) return res.status(404).json({ error: 'Server not found' });
    db.archiveSession(req.params.id, { id: text(req.params.thread, 'session ID', 200),
      name: text(req.body.name, 'session name', 1000), cwd: typeof req.body.cwd === 'string' ? req.body.cwd.slice(0, 4096) : '' });
    res.json({ archived: true });
  });
  router.delete('/servers/:id/sessions/:thread/archive', (req, res) => {
    if (!db.getServer(req.params.id)) return res.status(404).json({ error: 'Server not found' });
    db.restoreSession(req.params.id, req.params.thread); res.sendStatus(204);
  });
  router.post('/servers/:id/sessions', async (req, res) => {
    const cwd = text(req.body.cwd, 'working directory', 4096);
    if (!cwd.startsWith('/')) throw new Error('Use an absolute working directory');
    const prompt = text(req.body.prompt, 'first message');
    const session = await agents.create(req.params.id, cwd);
    try { await agents.input(req.params.id, session.id, prompt); res.status(201).json({ session }); }
    catch (error) { res.status(201).json({ session, error: (error as Error).message }); }
  });
  router.get('/servers/:id/sessions/:thread', async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    res.json(await agents.detail(req.params.id, req.params.thread, cursor));
  });
  router.get('/servers/:id/sessions/:thread/files', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await agents.directory(req.params.id, req.params.thread, req.query.path === undefined ? '.' : filePath(req.query.path)));
  });
  router.get('/servers/:id/sessions/:thread/file', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const file = await agents.file(req.params.id, req.params.thread, filePath(req.query.path));
      if (req.query.view === 'preview') return res.json(previewSessionFile(file.path, file.data));
      sendSessionFile(res, file.path, file.data, req.query.download === '1');
    } catch (error) {
      if (req.query.view === 'preview') return res.status(400).json({ error: `Cannot open file. ${(error as Error).message}` });
      res.status(400).type('text/plain').send(`Cannot open file. ${(error as Error).message}`);
    }
  });
  router.post('/servers/:id/sessions/:thread/input', async (req, res) => {
    const message = req.body.text === undefined || (typeof req.body.text === 'string' && !req.body.text.trim()) ? '' : text(req.body.text, 'message');
    res.json(await agents.input(req.params.id, req.params.thread, message,
      req.body.turnId ? text(req.body.turnId, 'turn ID', 200) : undefined,
      req.body.model === undefined ? undefined : text(req.body.model, 'model', 200),
      req.body.effort === undefined ? undefined : text(req.body.effort, 'reasoning effort', 50), req.body.images));
  });
  router.post('/servers/:id/sessions/:thread/shell', async (req, res) => {
    const command = text(req.body.command, 'shell command', 32_000);
    res.json(await agents.shell(req.params.id, req.params.thread, command));
  });
  router.post('/servers/:id/sessions/:thread/rename', async (req, res) => {
    await agents.rename(req.params.id, req.params.thread, text(req.body.name, 'session name', 1000));
    res.json({ renamed: true });
  });
  router.post('/servers/:id/sessions/:thread/interrupt', async (req, res) => {
    res.json(await agents.interrupt(req.params.id, req.params.thread, text(req.body.turnId, 'turn ID', 200)));
  });
  router.post('/servers/:id/sessions/:thread/requests/:request', async (req, res) => {
    await agents.answer(req.params.id, req.params.thread, req.params.request, req.body);
    res.json({ sent: true });
  });
  return router;
}
