// Frontend-only fixture: never connects to SSH or launches a coding CLI.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium } = await import(process.env.GATE_TEST_PLAYWRIGHT || 'playwright');
const dist = path.resolve('client/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const file = path.resolve(dist, '.' + new URL(request.url, 'http://localhost').pathname);
  if (!file.startsWith(dist + '/') || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.setHeader('Content-Type', 'text/html'); response.end(fs.readFileSync(path.join(dist, 'index.html'))); return;
  }
  response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.GATE_TEST_CHROMIUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const servers = ['Studio', 'Development'].map((name, index) => ({ id: `machine-${index}`, name, host: 'localhost', port: 22,
    username: 'developer', authType: 'privateKey', createdAt: 1 }));
  const sessions = servers.map((server, index) => ({ id: `session-${index}`, serverId: server.id, name: `${server.name} conversation`,
    provider: 'codex', workingDir: '/projects/gate', workspaceId: null, isHidden: false, createdAt: 1, lastActiveAt: 2 - index }));
  let offline = false;
  const monitor = { capturedAt: Date.now(), servers: servers.map((server, index) => ({ ...server, sessions: [{
    id: `chat:${sessions[index].id}`, sessionId: sessions[index].id, serverId: server.id,
    name: ['Refine the session panel', 'Review API changes'][index], provider: 'codex', cwd: '/projects/gate', source: 'chat',
    state: ['running', 'waiting'][index], activity: ['Updating the session list', 'Waiting for your approval'][index], updatedAt: Date.now(),
  }] })) };
  monitor.servers[0].sessions.push({ id: 'external:one', serverId: servers[0].id, name: 'Compiler benchmarks',
    provider: 'codex', cwd: '/projects/compiler', source: 'external', state: 'unknown',
    activity: 'No recent update · Working on a request', observation: 'transcript',
    updatedAt: Date.now() - 120_000, nativeSessionId: 'native-external' });
  monitor.servers[1].sessions.push({ id: 'chat:session-docs', sessionId: 'session-docs', serverId: servers[1].id, name: 'Update documentation',
    provider: 'codex', cwd: '/projects/docs', source: 'chat', state: 'completed',
    activity: 'Updated the getting started guide', updatedAt: Date.now() - 600_000, nativeSessionId: 'native-docs' });
  sessions.push({ ...sessions[1], id: 'session-docs', name: 'Update documentation' });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/monitor') {
      await route.fulfill(offline ? { status: 503, json: { error: 'Offline fixture' } } : { json: monitor }); return;
    }
    if (url.pathname.endsWith('/sessions') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      assert.equal(body.provider, 'codex');
      const created = { ...sessions[1], ...body, id: 'new-session' };
      sessions.push(created);
      await route.fulfill({ status: 201, json: created }); return;
    }
    const data = url.pathname === '/api/servers' ? servers
      : url.pathname.endsWith('/sessions') ? sessions.filter((item) => url.pathname.includes(item.serverId)) : [];
    await route.fulfill({ json: data });
  });
  const sent = [];
  const sockets = [];
  await context.routeWebSocket('**/ws', (socket) => { sockets.push(socket); socket.onMessage((message) => {
    const data = JSON.parse(String(message)); sent.push(data);
    if (data.type === 'connect') socket.send(JSON.stringify({ type: 'status', serverId: data.serverId,
      sessionId: data.sessionId, status: 'connected' }));
  }); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('heading', { name: 'Studio' }).waitFor();
  await page.getByRole('heading', { name: 'Development' }).waitFor();
  assert.equal(await page.getByRole('navigation').count(), 0, 'No menu is needed for the monitoring panel');
  assert.equal(sent.some((message) => message.type === 'connect'), false, 'Monitoring must not launch sessions');
  for (const width of [320, 390, 1365]) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(1, 899);
    assert.equal(await page.locator('button:visible, input:visible').evaluateAll((items) =>
      items.some((item) => { const box = item.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; })), false);
    await page.screenshot({ path: `/tmp/gate-monitor-${width}.png` });
  }
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('Development');
  assert.equal(await page.locator('.server-group').count(), 1);
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('');
  await page.getByRole('button', { name: /Refine the session panel/ }).click();
  await page.getByRole('button', { name: 'View diff', exact: true }).waitFor();
  assert.ok(sent.some((message) => message.type === 'connect' && message.sessionId === 'session-0'));
  await page.getByRole('button', { name: 'All sessions', exact: true }).click();
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor();
  const beforeExternal = sent.filter((message) => message.type === 'connect').length;
  await page.getByRole('button', { name: /Compiler benchmarks/ }).click();
  await page.getByRole('dialog').getByText(/Continue in the original terminal/).waitFor();
  await page.getByRole('dialog').getByText(/Discovered from Codex session files/).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  monitor.servers[1].discovery = { scanning: false, error: 'SSH connection timed out' };
  await page.getByRole('alert').filter({ hasText: 'Could not check terminal sessions' }).waitFor();
  assert.equal(sent.filter((message) => message.type === 'connect').length, beforeExternal, 'Reading external details must not launch a CLI');
  monitor.servers[1].discovery = { scanning: false, checkedAt: Date.now() };
  await page.getByRole('alert').filter({ hasText: 'Could not check terminal sessions' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'New session on Development' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('New work');
  await page.getByRole('textbox', { name: 'Directory', exact: true }).fill('/projects/new');
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  await page.getByRole('button', { name: 'View diff', exact: true }).waitFor();
  assert.ok(sent.some((message) => message.type === 'connect' && message.sessionId === 'new-session'));
  await page.getByRole('button', { name: 'All sessions', exact: true }).click();
  const connections = sent.filter((message) => message.type === 'connect').length;
  const socketCount = sockets.length;
  sockets.at(-1).close();
  await delay(1800);
  assert.ok(sockets.length > socketCount, 'The monitor WebSocket reconnects');
  assert.equal(sent.filter((message) => message.type === 'connect').length, connections, 'Returning to monitor clears automatic CLI resume');
  await page.getByRole('button', { name: 'Edit Studio' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  monitor.servers[0].sessions[0].state = 'completed';
  monitor.servers[0].sessions[0].activity = 'Changes verified';
  await page.getByRole('button', { name: /Refine the session panel/ }).getByText('Finished', { exact: true }).waitFor();
  offline = true;
  await page.getByRole('alert').filter({ hasText: 'retrying automatically' }).waitFor();
  assert.equal(await page.getByText('Unconfirmed', { exact: true }).count(), 4);
  offline = false;
  await page.getByRole('alert').filter({ hasText: 'retrying automatically' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.mouse.move(1, 899); await delay(250);
  await page.screenshot({ path: '/tmp/gate-monitor-dark.png' });
  assert.deepEqual(errors, []);
  console.log('Server-grouped monitoring, no automatic launch, session creation/opening, external details, live status, offline recovery and responsive themes passed');
} finally {
  await browser?.close();
  server.close();
}
