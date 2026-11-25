import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { createDb } from './db.js';
import { CodexService } from './codex.js';
import { AgentService } from './agents.js';
import { routes } from './routes.js';
import { INPUT_BODY_LIMIT } from './images.js';

const app = express();
app.use(express.json({ limit: INPUT_BODY_LIMIT }));
const dataDir = process.env.GATE_DATA_DIR || path.join(os.homedir(), '.gate');
fs.mkdirSync(dataDir, { recursive: true });
const db = createDb(path.join(dataDir, 'gate.db'));
const agents = new AgentService([{ tool: { id: 'codex', name: 'Codex', executable: 'codex', description: 'Native shared app-server over SSH.' }, backend: new CodexService() }]);
app.use('/api', routes(db, agents));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error.message });
});
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024 });
// Browser sockets only receive events. Mutations are explicit HTTP requests and are never queued or replayed.
const broadcast = (event: object) => {
  const data = JSON.stringify(event);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) {
    if (client.bufferedAmount > 2 * 1024 * 1024) client.terminate(); else client.send(data);
  }
};
agents.on('event', broadcast);
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!(client as any).alive) { client.terminate(); continue; }
    (client as any).alive = false; client.ping();
  }
}, 30_000);
wss.on('connection', (client) => {
  (client as any).alive = true;
  client.on('pong', () => { (client as any).alive = true; });
  client.on('error', () => client.terminate());
});
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
const port = Number(process.env.PORT) || 3030;
const host = process.env.HOST || '0.0.0.0';
http.listen(port, host, () => console.log(`Gate running on http://${host}:${port}`));
function shutdown() {
  clearInterval(heartbeat); agents.close(); db.close();
  for (const client of wss.clients) client.terminate();
  wss.close(); http.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
