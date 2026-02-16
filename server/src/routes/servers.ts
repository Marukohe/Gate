import { Router } from 'express';
import type { Database } from '../db.js';

export function createServerRoutes(db: Database): Router {
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
    const { name, host, port, username, authType, password, privateKeyPath } = req.body;
    if (!name || !host || !username || !authType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const server = db.createServer({ name, host, port: port ?? 22, username, authType, password, privateKeyPath });
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

  router.get('/:id/sessions', (req, res) => {
    res.json(db.listSessions(req.params.id));
  });

  return router;
}
