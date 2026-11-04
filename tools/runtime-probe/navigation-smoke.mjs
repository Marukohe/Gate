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
  const snapshot = { projects: [{ id: 'gate', name: 'Gate', defaultProvider: 'codex', scripts: {} }],
    checkouts: [{ id: 'checkout', projectId: 'gate', serverId: servers[0].id, path: '/projects/gate', kind: 'shared' }],
    tasks: ['Simplify navigation', 'Review connection recovery', 'Polish the task composer'].map((title, index) => ({
      id: `task-${index}`, projectId: 'gate', checkoutId: 'checkout', title, goal: title, provider: 'codex',
      status: ['in-progress', 'review', 'backlog'][index], acceptance: '', isolation: 'worktree' })),
    runs: [], attention: [], verifications: [], collaborations: [], deliveries: [], observedSessions: [], hookSettings: [] };
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const data = url.pathname === '/api/servers' ? servers : url.pathname === '/api/workbench' ? snapshot
      : url.pathname.endsWith('/sessions') ? sessions.filter((item) => url.pathname.includes(item.serverId)) : [];
    if (url.pathname.endsWith('/runtime')) {
      await route.fulfill(route.request().method() === 'PUT' ? { status: 400, json: { error: 'Fixture: Node.js path is unavailable.' } }
        : { json: { nodePath: '/usr/bin/node', claudePath: '/usr/bin/claude', codexPath: '/usr/bin/codex', directory: '/tmp/runtime' } });
      return;
    }
    await route.fulfill({ json: data });
  });
  const sent = [];
  await context.routeWebSocket('**/ws', (socket) => socket.onMessage((message) => {
    const data = JSON.parse(String(message)); sent.push(data);
    if (data.type === 'connect') socket.send(JSON.stringify({ type: 'status', serverId: data.serverId,
      sessionId: data.sessionId, status: 'connected' }));
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/#sessions');
  await page.getByRole('button', { name: /Studio conversation/ }).waitFor();
  await page.getByRole('button', { name: /Development conversation/ }).waitFor();
  assert.equal(sent.some((message) => message.type === 'connect'), false, 'Listing sessions must not launch them');
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('Development');
  assert.equal(await page.locator('.work-row').count(), 1);
  await page.getByRole('button', { name: /Development conversation/ }).click();
  await page.getByRole('button', { name: 'View diff', exact: true }).waitFor();
  assert.ok(sent.some((message) => message.type === 'connect' && message.sessionId === 'session-1'));
  assert.equal(await page.getByRole('navigation').count(), 1, 'Saved chat keeps the shared navigation');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  assert.equal(await nav.getByRole('link', { name: 'Sessions' }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: 'View diff', exact: true }).click();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await nav.getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
  for (const width of [320, 390, 1365]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('button:visible, a:visible, input:visible, select:visible').evaluateAll((items) =>
      items.some((item) => { const box = item.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; })), false);
    await page.mouse.move(1, 899);
    await delay(200);
    await page.screenshot({ path: `/tmp/gate-navigation-${width}.png` });
  }
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await delay(250);
  await page.screenshot({ path: '/tmp/gate-navigation-dark.png' });
  await page.getByRole('button', { name: /Simplify navigation/ }).click();
  await page.getByRole('button', { name: 'Runtime settings', exact: true }).click();
  assert.equal(await page.getByRole('dialog').locator('details').count(), 0);
  await page.getByRole('button', { name: 'Install / reconnect runtime' }).click();
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'Fixture: Node.js path is unavailable.' }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await nav.getByRole('link', { name: 'Machines' }).click();
  await page.getByRole('button', { name: /Studio/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await nav.getByRole('link', { name: 'Sessions' }).click();
  await page.getByRole('heading', { name: 'Sessions', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Flat navigation, cross-machine session search, explicit chat opening, return navigation, diff action, machine editing and responsive themes passed');
} finally {
  await browser?.close();
  server.close();
}
