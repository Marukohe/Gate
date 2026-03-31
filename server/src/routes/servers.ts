import { Router } from 'express';
import type { Database } from '../db.js';
import type { SSHManager } from '../ssh-manager.js';
import { listRemoteDirectory, createRemoteDirectory } from '../ssh-browse.js';

export function createServerRoutes(db: Database, sshManager?: SSHManager): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(db.listServers());
  });

  router.get('/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    res.json(server);
  });

  router.post('/', (req, res) => {
    const { name, host, port, username, authType, password, privateKeyPath, defaultWorkingDir } = req.body;
    if (!name || !host || !username || !authType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const server = db.createServer({ name, host, port: port ?? 22, username, authType, password, privateKeyPath, defaultWorkingDir });
    res.status(201).json(server);
  });

  router.put('/:id', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    db.updateServer(req.params.id, req.body);
    res.json(db.getServer(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    db.deleteServer(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/browse', async (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const dirPath: string = req.body.path || '$HOME';
    try {
      const result = await listRemoteDirectory({
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType as 'password' | 'privateKey',
        password: server.password,
        privateKeyPath: server.privateKeyPath,
      }, dirPath);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/mkdir', async (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const { parentPath, name } = req.body;
    if (!parentPath || !name) return res.status(400).json({ error: 'Missing parentPath or name' });
    try {
      const createdPath = await createRemoteDirectory({
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType as 'password' | 'privateKey',
        password: server.password,
        privateKeyPath: server.privateKeyPath,
      }, parentPath, name);
      res.json({ path: createdPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:id/sessions', (req, res) => {
    res.json(db.listSessions(req.params.id));
  });

  router.post('/:id/sessions', (req, res) => {
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const { name, workingDir } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const session = db.createSession(server.id, name, workingDir || null);
    res.status(201).json(session);
  });

  router.put('/:id/sessions/:sessionId', (req, res) => {
    const session = db.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    db.renameSession(session.id, name);
    res.json({ ...session, name });
  });

  router.delete('/:id/sessions/:sessionId', (req, res) => {
    db.deleteSession(req.params.sessionId);
    res.status(204).end();
  });

  // Upload file to remote server via SFTP (base64 encoded)
  router.post('/:id/sessions/:sessionId/upload', async (req, res) => {
    if (!sshManager) return res.status(500).json({ error: 'SSH manager not available' });
    const server = db.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    const session = db.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { fileName, data } = req.body;
    if (!fileName || !data) return res.status(400).json({ error: 'Missing fileName or data' });

    try {
      if (!sshManager.isConnected(server.id)) {
        return res.status(400).json({ error: 'Not connected to server' });
      }

      // Upload to global directory (~/.gate/uploads/) to avoid polluting git repos
      const uploadDir = '$HOME/.gate/uploads';
      await sshManager.runCommand(server.id, null, `mkdir -p '${uploadDir}'`);

      // Add timestamp prefix to avoid collisions
      const remoteName = `${Date.now()}-${fileName}`;

      // Resolve $HOME to get absolute path for SFTP
      const { stdout: homePath } = await sshManager.runCommand(server.id, null, 'echo $HOME');
      const resolvedDir = `${homePath.trim()}/.gate/uploads`;
      const remotePath = `${resolvedDir}/${remoteName}`;

      const fileBuffer = Buffer.from(data, 'base64');
      await sshManager.uploadFile(server.id, remotePath, fileBuffer);

      res.json({ remotePath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
