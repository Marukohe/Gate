import express from 'express';
import { createServer } from 'http';
import { createDb } from './db.js';
import { createServerRoutes } from './routes/servers.js';
import { setupWebSocket } from './ws-handler.js';

const app = express();
const PORT = 3001;

app.use(express.json());

const db = createDb('./data/codingeverywhere.db');

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/servers', createServerRoutes(db));

const httpServer = createServer(app);

setupWebSocket(httpServer, db);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
