import { Router } from 'express';
import type { Database } from './db.js';
import { publicServer } from './db.js';
import type { CodexService } from './codex.js';
import type { Server } from './types.js';

function text(value: unknown, name: string, max = 200_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${name}`);
  return value.trim();
}
export function routes(db: Database, codex: CodexService) {
  const router = Router();
  const sync = () => codex.sync(db.listServers());
  sync();
  router.get('/health', (_req, res) => res.json({ status: 'ok' }));
  router.get('/servers', (_req, res) => res.json(db.listServers().map(publicServer)));
  const settings = (body: any, existing?: Server) => {
    const port = Number(body.port ?? 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
    if (!['password', 'privateKey'].includes(body.authType)) throw new Error('Invalid authentication method');
    return { name: text(body.name, 'name', 200), host: text(body.host, 'host', 500), username: text(body.username, 'username', 200),
      port, authType: body.authType as Server['authType'], password: body.password || existing?.password || '',
      privateKeyPath: body.privateKeyPath ? text(body.privateKeyPath, 'key path', 4096) : '',
      defaultWorkingDir: body.defaultWorkingDir ? text(body.defaultWorkingDir, 'directory', 4096) : '',
      codexPath: body.codexPath ? text(body.codexPath, 'Codex executable', 4096) : 'codex' };
  };
  router.post('/servers', (req, res) => { const server = db.createServer(settings(req.body)); sync(); res.status(201).json(publicServer(server)); });
  router.put('/servers/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    db.updateServer(server.id, settings(req.body, server)); sync(); res.json(publicServer(db.getServer(server.id)!));
  });
  router.delete('/servers/:id', (req, res) => { db.deleteServer(req.params.id); sync(); res.sendStatus(204); });
  router.get('/monitor', (_req, res) => res.json(codex.monitor()));
  router.post('/servers/:id/sessions', async (req, res) => {
    const cwd = text(req.body.cwd, 'working directory', 4096);
    if (!cwd.startsWith('/')) throw new Error('Use an absolute working directory');
    const prompt = text(req.body.prompt, 'first message');
    const session = await codex.create(req.params.id, cwd);
    try { await codex.input(req.params.id, session.id, prompt); res.status(201).json({ session }); }
    catch (error) { res.status(201).json({ session, error: (error as Error).message }); }
  });
  router.get('/servers/:id/sessions/:thread', async (req, res) => {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    res.json(await codex.detail(req.params.id, req.params.thread, cursor));
  });
  router.post('/servers/:id/sessions/:thread/input', async (req, res) => {
    res.json(await codex.input(req.params.id, req.params.thread, text(req.body.text, 'message'),
      req.body.turnId ? text(req.body.turnId, 'turn ID', 200) : undefined));
  });
  router.post('/servers/:id/sessions/:thread/interrupt', async (req, res) => {
    res.json(await codex.interrupt(req.params.id, req.params.thread, text(req.body.turnId, 'turn ID', 200)));
  });
  router.post('/servers/:id/sessions/:thread/requests/:request', async (req, res) => {
    await codex.answer(req.params.id, req.params.thread, req.params.request, req.body);
    res.json({ sent: true });
  });
  return router;
}
