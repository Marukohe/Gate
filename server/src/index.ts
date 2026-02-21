import express from 'express';
import { createServer } from 'http';
import { createDb } from './db.js';
import { createServerRoutes } from './routes/servers.js';
import { setupWebSocket } from './ws-handler.js';
import { listRemoteDirectory, createRemoteDirectory } from './ssh-browse.js';

const app = express();
const PORT = 3001;

app.use(express.json());

const db = createDb('./data/codingeverywhere.db');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Ad-hoc browse: list remote directories without a saved server
app.post('/api/browse', async (req, res) => {
  const { host, port, username, authType, password, privateKeyPath, path: dirPath } = req.body;
  if (!host || !username || !authType) {
    return res.status(400).json({ error: 'Missing connection fields' });
  }
  try {
    const result = await listRemoteDirectory(
      { host, port: port ?? 22, username, authType, password, privateKeyPath },
      dirPath || '$HOME',
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ad-hoc mkdir: create a directory on a remote server without a saved server
app.post('/api/mkdir', async (req, res) => {
  const { host, port, username, authType, password, privateKeyPath, parentPath, name } = req.body;
  if (!host || !username || !authType || !parentPath || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const createdPath = await createRemoteDirectory(
      { host, port: port ?? 22, username, authType, password, privateKeyPath },
      parentPath, name,
    );
    res.json({ path: createdPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/servers', createServerRoutes(db));

const httpServer = createServer(app);

setupWebSocket(httpServer, db);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
