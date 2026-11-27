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
import { AgyService } from './agy.js';
import { routes } from './routes.js';
import { INPUT_BODY_LIMIT } from './images.js';
import { gateAuth, loadAccessToken } from './auth.js';
import { Gateways } from './gateways.js';

const app = express();
const dataDir = process.env.GATE_DATA_DIR || path.join(os.homedir(), '.gate');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const { token, source } = loadAccessToken(dataDir, process.env.GATE_TOKEN);
const databaseFile = path.join(dataDir, 'gate.db');
const db = createDb(databaseFile);
for (const file of [databaseFile, databaseFile + '-wal', databaseFile + '-shm']) {
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
}
const access = gateAuth(token, db.instanceId);
app.use('/api', access.router);
app.use(express.json({ limit: INPUT_BODY_LIMIT }));
const agents = new AgentService([
  { tool: { id: 'codex', name: 'Codex', executable: 'codex', description: 'Connect to existing terminal sessions through the native shared backend.' }, backend: new CodexService() },
  { tool: { id: 'agy', name: 'Antigravity (agy)', executable: 'agy', description: 'Sign in on this SSH server with agy acp --login. Live status covers work started through Gate.' }, backend: new AgyService() },
]);
const http = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const localOnly = new WeakSet<WebSocket>();
http.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/ws') { socket.destroy(); return; }
  if (!access.auth(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, (client) => {
    if (new URLSearchParams(req.url?.split('?')[1]).get('local') === '1') localOnly.add(client);
    wss.emit('connection', client, req);
  });
});
// Browser sockets only receive events. Mutations are explicit HTTP requests and are never queued or replayed.
const broadcast = (event: object, relayed = false) => {
  const data = JSON.stringify(event);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN && !(relayed && localOnly.has(client))) {
    if (client.bufferedAmount > 2 * 1024 * 1024) client.terminate(); else client.send(data);
  }
};
agents.on('event', broadcast);
const gateways = new Gateways(db, (event) => broadcast(event, true));
app.use('/api', gateways.router());
app.use('/api', routes(db, agents, undefined, undefined, gateways));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error.message });
});
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!(client as any).alive) { client.terminate(); continue; }
    (client as any).alive = false; client.ping();
  }
}, 30_000);
wss.on('connection', (client, req) => {
  (client as any).alive = true;
  client.on('pong', () => { (client as any).alive = true; });
  client.on('error', () => client.terminate());
  client.on('pong', () => { if (!access.auth(req)) client.close(1008, 'Access expired'); });
});
const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
const port = Number(process.env.PORT) || 3030;
const host = process.env.HOST || '0.0.0.0';
http.listen(port, host, () => console.log(`Gate running on http://${host}:${port}\nAccess token: ${source}`));
function shutdown() {
  clearInterval(heartbeat); gateways.close(); agents.close(); db.close();
  for (const client of wss.clients) client.terminate();
  wss.close(); http.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
