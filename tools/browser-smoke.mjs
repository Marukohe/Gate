import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import { createDb } from '../server/dist/db.js';
import { routes } from '../server/dist/routes.js';
import { INPUT_BODY_LIMIT } from '../server/dist/images.js';
const imageFile = { name: '截图.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
const imageUrl = 'data:image/png;base64,' + imageFile.buffer.toString('base64');
const db = createDb(':memory:');

// Isolated native-session fixtures: no SSH connections or real user conversations.
const server = { id: 'dev', name: 'Development', host: 'dev.local', username: 'alex', port: 22,
  authType: 'privateKey', privateKeyPath: '~/.ssh/id_ed25519', defaultWorkingDir: '/home/alex/projects/gate', hasPassword: false };
server.id = db.createServer(server).id;
const session = (id, name, state, preview) => ({ id, name, state, preview, cwd: `/home/alex/projects/${name}`,
  updatedAt: Date.now() - 120000, canInput: true });
const sessions = [session('api', 'api', 'waiting', 'The migration is ready. May I run the database tests?'),
  session('website', 'website', 'running', 'Updating the settings page and checking mobile layouts.'),
  session('gate', 'gate', 'idle', 'All checks passed. The change is ready to review.')];
sessions.push({ ...session('api-worktree', 'Validate migrations', 'running', 'Checking the migration on a feature branch.'),
  cwd: '/home/alex/worktrees/api-fix', projectPath: '/home/alex/projects/api' });
for (let i = 0; i < 12; i++) sessions.push({ ...session(`past-${i}`, `Past API session ${i}`, 'saved', `Migration notes ${i}`),
  cwd: '/home/alex/projects/api/src', projectPath: '/home/alex/projects/api' });
sessions.push({ ...session('archived-api', 'Archived API work', 'saved', 'Older deployment notes.'),
  cwd: '/home/alex/archive/api', projectPath: '/home/alex/archive/api' });
const monitor = { servers: [{ ...server, state: 'connected', sessions, hasMore: false },
  { id: 'build', name: 'Build server', host: 'build.local', username: 'alex', state: 'connected', hasMore: false,
    sessions: [session('compiler', 'compiler', 'running', 'Running the compiler regression suite.'),
      session('tools', 'tools', 'saved', 'Added a small command to inspect build artifacts.')] }] };
let detail = { session: { ...sessions[2], model: 'fixture-current', effort: 'high' }, items: [{ id: 'u1', kind: 'user', text: 'Simplify the session panel.' },
  { id: 'a1', kind: 'assistant', text: 'The panel now groups sessions by server.\n\n- Running work stays visible.\n- Questions appear in the conversation.\n- Each session has one place to continue.' }],
  nextCursor: 'older', turnId: null, requests: [] };
const writes = [];
let modelsUnavailable = false;
let holdInput = false;
let releaseInput;
let holdShell = false;
let releaseShell;
let historyProbe = false;
let sparseHistory = false;
let probeStream = '';
let releaseHistory;
let failHistory = true;
const historyRequests = [];
const probeMessages = (prefix, count) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, kind: 'assistant',
  text: `${prefix} message ${i}\n\nA paragraph to make this conversation scroll.` + (prefix === 'current' && i === 39
    ? '\n\n```ts\nconst answer = 42;\n```\n\n| Name | Value |\n| --- | --- |\n| answer | 42 |' + probeStream : '') }));
const app = express(); app.use(express.json({ limit: INPUT_BODY_LIMIT }));
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });
const emit = (event = {}) => {
  if (historyProbe && event.type === 'delta' && event.itemId === 'current-39') probeStream += event.delta;
  for (const socket of wss.clients) socket.send(JSON.stringify({ serverId: server.id, threadId: detail.session.id, type: 'changed', ...event }));
};
app.get('/api/servers', (_req, res) => res.json([server]));
app.get('/api/servers/:id/models', (_req, res) => modelsUnavailable
  ? res.status(503).json({ error: 'Catalog unavailable' })
  : res.json({ models: [
    { id: 'fixture-current', name: 'Current', defaultEffort: 'medium', efforts: [{ id: 'medium', description: '' }, { id: 'high', description: 'Deeper thinking' }] },
    { id: 'fixture-other', name: 'Other model', defaultEffort: 'low', efforts: [{ id: 'low', description: '' }, { id: 'medium', description: '' }] },
  ] }));

app.get('/api/servers/:id/sessions/:thread', async (req, res) => {
  if (historyProbe && req.params.thread === 'gate') {
    if (!req.query.cursor) return res.json({ ...detail, items: probeMessages('current', 40), nextCursor: 'probe-1' });
    historyRequests.push(req.query.cursor);
    if (req.query.cursor === 'probe-1') {
      if (sparseHistory) return res.json({ ...detail, items: [], nextCursor: 'probe-2' });
      await new Promise(resolve => { releaseHistory = resolve; });
      return res.json({ ...detail, items: probeMessages('older', 20), nextCursor: 'probe-2' });
    }
    if (failHistory) return res.status(503).json({ error: 'Could not load older messages. Please retry.' });
    return res.json({ ...detail, items: [...probeMessages('ancient', 20), probeMessages('older', 1)[0]], nextCursor: null });
  }
  const target = monitor.servers.find(s => s.id === req.params.id)?.sessions.find(s => s.id === req.params.thread);
  const value = req.params.thread === detail.session.id || !target ? detail : { ...detail,
    session: { ...target, model: 'fixture-current', effort: 'high' }, turnId: target.state === 'running' ? `turn-${target.id}` : null,
    items: [{ id: 'intro', kind: 'assistant', text: 'The panel now groups sessions by server.' }], nextCursor: null, requests: [] };
  res.json(req.query.cursor ? { ...value, items: [{ id: 'old', kind: 'user', text: 'Earlier context.' }], nextCursor: null } : value);
});
app.post('/api/servers/:id/sessions', (req, res) => {
  writes.push({ type: 'create', ...req.body });
  detail = { ...detail, session: { ...session('created', 'gate', 'running', req.body.prompt), cwd: req.body.cwd },
    items: [{ id: 'first', kind: 'user', text: req.body.prompt }], turnId: 'turn-one', nextCursor: null };
  res.status(201).json({ session: detail.session });
});
app.post('/api/servers/:id/sessions/:thread/input', async (req, res) => {
  writes.push({ type: 'input', ...req.body });
  if (holdInput) await new Promise(resolve => { releaseInput = resolve; });
  if (req.body.model) detail.session.model = req.body.model;
  if (req.body.effort) detail.session.effort = req.body.effort;
  detail.items.push({ id: `message-${writes.length}`, kind: 'user', text: req.body.text, images: req.body.images });
  detail.turnId = 'turn-two'; detail.session.state = 'running'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/interrupt', (req, res) => {
  writes.push({ type: 'interrupt', ...req.body }); detail.turnId = null; detail.session.state = 'idle'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/requests/:request', (req, res) => {
  writes.push({ type: 'answer', ...req.body }); detail.requests = []; res.json({}); emit();
});
app.use('/api', routes(db, { sync() {}, monitor: () => structuredClone(monitor), async shell(serverId, threadId, command) {
  writes.push({ type: 'shell', serverId, threadId, command });
  if (holdShell) await new Promise(resolve => { releaseShell = resolve; });
  return { stdout: command === 'pwd' ? '/home/alex/projects/gate\n' : 'shell-ok\n', stderr: command === 'pwd' ? '' : 'shell-error\n',
    exitCode: command === 'pwd' ? 0 : 7, timedOut: false, truncated: false };
}, async file(serverId, threadId, path) {
  assert.equal(serverId, server.id); assert.equal(threadId, detail.session.id);
  if (path.endsWith('.png')) return { path, data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
  if (path === 'missing.txt') throw new Error('No such file');
  return { path: '/remote/repo/' + path, data: Buffer.from('first line\n<script>window.fileExecuted = true</script>\nthird line') };
}, async rename(serverId, threadId, name) {
  writes.push({ type: 'rename', serverId, threadId, name });
  detail.session.name = name;
  for (const s of sessions) if (s.id === threadId) s.name = name;
  emit();
} }));
app.use((error, _req, res, _next) => res.status(400).json({ error: error.message }));
app.use(express.static(fileURLToPath(new URL('../client/dist/', import.meta.url))));
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1365, height: 1200 }, serviceWorkers: 'block' });
page.setDefaultTimeout(10000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const shotDir = process.env.GATE_SCREENSHOT_DIR;
async function shot(name) { if (shotDir) { await mkdir(shotDir, { recursive: true }); await page.screenshot({ path: `${shotDir}/${name}.png` }); } }
async function bounded() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page overflows viewport');
  const controls = page.getByRole('button', { name: 'Send message', exact: true });
  if (await controls.count()) {
    const box = await controls.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width && box.y + box.height <= page.viewportSize().height);
  }
}
try {
  await page.goto(`http://127.0.0.1:${http.address().port}`);
  await page.getByRole('button', { name: /^api Needs you/ }).waitFor();
  assert.equal(await page.getByRole('navigation').count(), 0);
  const runningProject = page.getByRole('group', { name: 'Project /home/alex/projects/website', exact: true });
  const collapseRunning = runningProject.getByRole('button', { name: 'Collapse sessions in website' });
  assert.equal(await collapseRunning.isEnabled(), true);
  assert.equal(await collapseRunning.getAttribute('aria-expanded'), 'true');
  await collapseRunning.click();
  assert.equal(await runningProject.getByRole('button', { name: /^website Running/ }).count(), 0);
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await runningProject.getByRole('button', { name: /^website Running/ }).count(), 0);
  await runningProject.getByRole('button', { name: 'Show all sessions in website' }).click();
  await runningProject.getByRole('button', { name: /^website Running/ }).waitFor();
  const project = page.getByRole('group', { name: 'Project /home/alex/projects/api', exact: true });
  assert.equal(await page.getByRole('group', { name: 'Project /home/alex/worktrees/api-fix', exact: true }).count(), 0);
  await project.getByRole('button', { name: /^Validate migrations/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^gate Idle/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Past API session/ }).count(), 0);
  assert.match(await page.getByRole('group', { name: /^Project / }).first().getAttribute('aria-label'), /projects\/api$/);
  await page.getByRole('button', { name: 'Show all sessions in api (archive)' }).waitFor();
  const heading = project.getByRole('heading', { name: 'Show all sessions in api (projects)' });
  assert.equal(await heading.getByRole('button').getAttribute('title'), '/home/alex/projects/api');
  assert.equal(await project.getByText('/home/alex/projects/api', { exact: true }).count(), 0);
  assert.equal(await project.getByText('Show 12 past sessions', { exact: true }).count(), 0);
  await heading.getByRole('button').focus();
  await page.keyboard.press('Enter');
  assert.equal(await project.getByRole('button', { name: /^Past API session/ }).count(), 12);
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await project.getByRole('button', { name: /^Past API session/ }).count(), 12);
  await project.getByRole('button', { name: 'Collapse sessions in api (projects)' }).click();
  assert.equal(await project.getByRole('button', { name: /^Validate migrations/ }).count(), 0);
  await page.getByLabel('Search sessions').fill('Migration notes 7');
  await page.getByRole('button', { name: /^Past API session 7/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Show all sessions in api (projects)' }).count(), 0);
  await page.getByLabel('Search sessions').fill('');
  assert.equal(await page.getByRole('button', { name: /^Past API session/ }).count(), 0);
  assert.equal(await project.getByRole('button', { name: /^Validate migrations/ }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: /^api Needs you/ }).waitFor();
  await page.getByLabel('Search sessions').blur();
  await shot('session-monitor');
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await bounded(); }
  await shot('monitor-mobile');
  const savedProject = page.getByRole('group', { name: 'Project /home/alex/projects/gate', exact: true });
  assert.ok((await savedProject.boundingBox()).height <= 52, 'An inactive project should occupy one row');
  await savedProject.getByRole('button', { name: 'Show all sessions in gate' }).click();
  await savedProject.getByRole('button', { name: /^gate Idle/ }).waitFor();
  await savedProject.getByRole('button', { name: 'Collapse sessions in gate' }).click();
  const runningCard = page.getByRole('button', { name: 'Running', exact: true });
  const waitingCard = page.getByRole('button', { name: 'Needs you', exact: true });
  await runningProject.getByRole('button', { name: 'Collapse sessions in website' }).click();
  await runningCard.click();
  assert.equal(await runningCard.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.monitor-session').count(), 3);
  await runningProject.getByRole('button', { name: /^website Running/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^api Needs you/ }).count(), 0);
  assert.equal(await savedProject.count(), 0);
  await page.getByLabel('Search sessions').fill('Validate migrations');
  assert.equal(await page.locator('.monitor-session').count(), 1);
  assert.match(await runningCard.innerText(), /3/);
  await page.getByLabel('Search sessions').fill('');
  await bounded(); await shot('running-mobile');
  await waitingCard.click();
  assert.equal(await runningCard.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.monitor-session').count(), 1);
  await page.getByRole('button', { name: /^api Needs you/ }).waitFor();
  sessions[0].state = 'running';
  await page.getByText('No sessions need your attention.', { exact: true }).waitFor();
  await runningCard.click();
  assert.equal(await page.locator('.monitor-session').count(), 4);
  sessions[0].state = 'waiting';
  await page.getByRole('button', { name: /^api Running/ }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Validate migrations Running/ }).click();
  await page.getByText('The panel now groups sessions by server.').waitFor();
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const header = await page.locator('header').boundingBox();
    const conversation = await page.getByRole('region', { name: 'Conversation', exact: true }).boundingBox();
    assert.ok(header.height <= 52, 'Chat header should occupy one compact row');
    assert.ok(Math.abs(conversation.y - header.y - header.height) < 1, 'Conversation should start directly below the header');
    await bounded();
  }
  const headerRunning = page.getByRole('button', { name: 'Running sessions', exact: true });
  assert.match(await headerRunning.innerText(), /Running\s*3/, 'Running count includes the current running conversation');
  await headerRunning.click();
  assert.equal(await page.getByRole('button', { name: /^Validate migrations Current/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Close session list', exact: true }).click();
  await page.getByRole('button', { name: 'All sessions', exact: true }).click();
  await page.getByRole('button', { name: /^Validate migrations Running/ }).waitFor();
  assert.equal(await runningCard.getAttribute('aria-pressed'), 'true', 'Returning from chat must keep the status filter');
  assert.equal(await page.getByRole('button', { name: /^api Needs you/ }).count(), 0);
  await runningCard.click();
  await page.getByRole('button', { name: /^api Needs you/ }).waitFor();
  assert.equal(await runningCard.getAttribute('aria-pressed'), 'false');
  // Exercise real visibility routes and SQLite through the browser, then reload the page.
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  await page.getByRole('button', { name: 'Hide /home/alex/projects/api', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Hide /home/alex/projects/api/src', exact: true }).count(), 0);
  assert.equal(await page.getByRole('list', { name: 'Blocked directories', exact: true }).isVisible(), false);
  await page.getByText('Blocked directories (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Show /home/alex/projects/api', exact: true }).click();
  await page.getByRole('button', { name: 'Hide /home/alex/projects/api/src', exact: true }).waitFor();
  await page.getByText('Blocked directories (0)', { exact: true }).click();
  await page.getByLabel('Search directories', { exact: true }).fill('website');
  await page.getByRole('button', { name: 'Hide /home/alex/projects/website', exact: true }).click();
  await page.getByLabel('Search directories', { exact: true }).fill('api');
  await page.getByLabel('Search directories', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  await page.getByRole('group', { name: 'Project /home/alex/projects/website', exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(db.getVisibility(server.id).excludedDirectories, ['/home/alex/projects/website']);
  await page.reload();
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  assert.equal(await page.getByRole('button', { name: 'Hide /home/alex/projects/website', exact: true }).count(), 0);
  assert.equal(await page.getByRole('list', { name: 'Blocked directories', exact: true }).isVisible(), false);
  await page.getByText('Blocked directories (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Show /home/alex/projects/website', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Search sessions').fill('website');
  await page.getByText('No matching sessions.', { exact: true }).waitFor();
  await page.getByLabel('Search sessions').fill('');
  await page.getByRole('button', { name: 'Archive Validate migrations', exact: true }).click();
  await page.getByRole('button', { name: /^Validate migrations/ }).waitFor({ state: 'hidden' });
  assert.equal(db.getVisibility(server.id).archivedSessions[0].id, 'api-worktree');
  await page.reload();
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  await page.getByText('Archived sessions (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Restore Validate migrations', exact: true }).waitFor();
  await bounded(); await shot('session-filters-mobile');
  await page.getByRole('button', { name: 'Restore Validate migrations', exact: true }).click();
  await page.getByText('Archived sessions (0)', { exact: true }).waitFor();
  assert.equal(db.getVisibility(server.id).archivedSessions.length, 0);
  await page.getByText('Blocked directories (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Show /home/alex/projects/website', exact: true }).click();
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  await page.getByRole('button', { name: /^Validate migrations/ }).waitFor();
  await page.getByRole('group', { name: 'Project /home/alex/projects/website', exact: true }).waitFor();
  const parent = '/home/alex/Codex';
  const dated = (id, cwd) => ({ ...session(id, id, 'saved', 'Dated work'), cwd });
  sessions.push(dated('dated-old', `${parent}/2026-11-05`), dated('dated-neighbor', `${parent}-backup`));
  await page.getByRole('group', { name: `Project ${parent}/2026-11-05`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  assert.equal(await page.getByRole('button', { name: `Hide ${parent}`, exact: true }).count(), 0);
  await page.getByLabel('Add another directory', { exact: true }).fill('relative/path');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('alert').getByText('Use an absolute directory path.', { exact: true }).waitFor();
  await page.getByLabel('Add another directory', { exact: true }).fill(`${parent}/`);
  await page.getByLabel('Add another directory', { exact: true }).press('Enter');
  assert.equal(await page.getByRole('button', { name: `Hide ${parent}/2026-11-05`, exact: true }).count(), 0);
  await page.getByText('Blocked directories (1)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('list', { name: 'Blocked directories', exact: true }).isVisible(), false);
  await bounded(); await shot('custom-directory-mobile');
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  await page.getByRole('group', { name: `Project ${parent}/2026-11-05`, exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('group', { name: `Project ${parent}-backup`, exact: true }).waitFor();
  sessions.push(dated('dated-future', `${parent}/2026-11-07`));
  const futureSnapshot = await page.request.get(`http://127.0.0.1:${http.address().port}/api/monitor`);
  assert.equal((await futureSnapshot.json()).servers[0].sessions.some(s => s.id === 'dated-future'), false);
  await page.reload();
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  await page.getByText('Blocked directories (1)', { exact: true }).click();
  await page.getByRole('button', { name: `Show ${parent}`, exact: true }).click();
  // Saving also includes a typed path when the user skips the Add button.
  await page.getByLabel('Add another directory', { exact: true }).fill('/home/alex/not-yet-created');
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  assert.deepEqual(db.getVisibility(server.id).excludedDirectories, ['/home/alex/not-yet-created']);
  await page.getByRole('group', { name: `Project ${parent}/2026-11-07`, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Filter sessions on Development' }).click();
  await page.getByText('Blocked directories (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Show /home/alex/not-yet-created', exact: true }).click();
  await page.getByRole('button', { name: 'Save filters', exact: true }).click();
  sessions.splice(sessions.findIndex(s => s.id === 'dated-old'), 3);
  await page.getByLabel('Search sessions').fill('gate');
  await page.getByRole('button', { name: /^gate Idle/ }).click();
  await page.getByText('The panel now groups sessions by server.').waitFor();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('Do not save');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(writes.some(w => w.type === 'rename'), false);
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('修复登录 · Gate');
  await bounded(); await shot('rename-mobile');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { type: 'rename', serverId: server.id, threadId: 'gate', name: '修复登录 · Gate' });
  const originalItems = detail.items;
  detail.items = [...originalItems, { id: 'file-links', kind: 'assistant', text:
    '[Source](src/main.ts:2) · [Absolute](file:///tmp/a%20b.txt#L3) · [Missing](missing.txt) · [Website](https://example.com/)\n\n![Local chart](sandbox:/tmp/chart.png)' }];
  await page.reload();
  const chart = page.getByRole('img', { name: 'Local chart', exact: true });
  await chart.waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="Local chart"]')?.naturalWidth === 1);
  const sourceLink = page.getByRole('link', { name: 'Source', exact: true });
  const previewPromise = page.waitForEvent('popup');
  await sourceLink.click();
  const preview = await previewPromise; await preview.waitForLoadState();
  assert.equal(new URL(preview.url()).hash, '#L2');
  assert.ok((await preview.locator('#L2').textContent()).includes('<script>'));
  assert.equal(await preview.evaluate(() => window.fileExecuted), undefined, 'File content must remain inert');
  await preview.close();
  const absoluteURL = new URL(await page.getByRole('link', { name: 'Absolute', exact: true }).getAttribute('href'), page.url());
  assert.equal(absoluteURL.searchParams.get('path'), '/tmp/a b.txt');
  assert.equal(absoluteURL.hash, '#L3');
  assert.equal(await page.getByRole('link', { name: 'Website', exact: true }).getAttribute('href'), 'https://example.com/');
  const missingPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Missing', exact: true }).click();
  const missing = await missingPromise; await missing.waitForLoadState();
  assert.match(await missing.locator('body').textContent(), /Cannot open file.*No such file/);
  await missing.close();
  detail.items = originalItems;
  historyProbe = true;
  await page.reload();
  await page.getByText('current message 39', { exact: false }).waitFor();
  const historyViewport = page.getByRole('region', { name: 'Conversation', exact: true });
  const richMessage = page.locator('[data-message-id="current-39"]');
  await richMessage.getByRole('button', { name: 'Wrap', exact: true }).click();
  const originalCodeControl = await richMessage.getByRole('button', { name: 'Copy code', exact: true }).elementHandle();
  // Reproduce a refresh captured before live output but delivered after that output.
  let releaseSnapshot;
  let snapshotReady;
  const snapshotCaptured = new Promise(resolve => { snapshotReady = resolve; });
  const snapshotHeld = new Promise(resolve => { releaseSnapshot = resolve; });
  await page.route(url => url.pathname.endsWith('/sessions/gate') && !url.search, async route => {
    const response = await route.fetch();
    snapshotReady();
    await snapshotHeld;
    await route.fulfill({ response });
  }, { times: 1 });
  emit();
  await snapshotCaptured;
  emit({ type: 'delta', itemId: 'current-39', delta: '\n\n' + 'New output while refresh is pending.\n\n'.repeat(20) });
  await page.getByText('New output while refresh is pending.', { exact: true }).first().waitFor();
  const streamHeight = await historyViewport.evaluate(node => node.scrollHeight);
  const staleResponse = page.waitForResponse(response => response.url().endsWith('/sessions/gate'));
  releaseSnapshot(); await staleResponse;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('New output while refresh is pending.', { exact: true }).count(), 20, 'A delayed refresh must not erase live output');
  assert.equal(await historyViewport.evaluate(node => node.scrollHeight), streamHeight, 'A delayed refresh must not collapse the conversation');
  probeStream += '\n\nReconciled from the server.';
  emit();
  await page.getByText('Reconciled from the server.', { exact: true }).waitFor();
  assert.equal(historyRequests.length, 0, 'Opening history must not automatically drain older pages');
  const historyButton = page.getByRole('button', { name: 'Earlier messages', exact: true });
  const historyControlBefore = await historyButton.evaluate(node => ({ width: node.getBoundingClientRect().width, opacity: getComputedStyle(node).opacity }));
  const firstHistoryRequest = page.waitForRequest(request => request.url().includes('cursor=probe-1'));
  await historyViewport.evaluate(node => { node.scrollTop = 0; });
  await firstHistoryRequest;
  await page.waitForFunction(() => document.querySelector('[aria-label="Conversation"] button')?.getAttribute('aria-busy') === 'true');
  assert.equal(await historyButton.isDisabled(), true);
  assert.deepEqual(await historyButton.evaluate(node => ({ width: node.getBoundingClientRect().width, opacity: getComputedStyle(node).opacity })),
    historyControlBefore, 'History loading must not change the control width, label, or opacity');
  assert.equal(await originalCodeControl.evaluate(node => node.isConnected), true, 'Loading history must not remount existing code blocks');
  assert.equal(await richMessage.getByRole('button', { name: 'Scroll', exact: true }).count(), 1, 'Loading must preserve table wrapping');
  await historyViewport.evaluate(node => {
    for (let i = 0; i < 4; i++) {
      node.scrollTop = 80; node.dispatchEvent(new Event('scroll'));
      node.scrollTop = 0; node.dispatchEvent(new Event('scroll'));
    }
  });
  emit({ type: 'delta', itemId: 'current-39', delta: '\n\n' + 'Streaming content below.\n\n'.repeat(40) });
  await page.getByText('Streaming content below.', { exact: false }).first().waitFor();
  assert.equal(await originalCodeControl.evaluate(node => node.isConnected), true, 'Streaming must retain existing code blocks');
  assert.equal(await richMessage.getByRole('button', { name: 'Scroll', exact: true }).count(), 1, 'Streaming must preserve table wrapping');
  const firstCurrent = page.locator('[data-message-id="current-0"]');
  const anchorBefore = await firstCurrent.boundingBox();
  assert.deepEqual(historyRequests, ['probe-1'], 'Rapid scrolls must share the pending history request');
  releaseHistory();
  await page.getByText('older message 0', { exact: false }).waitFor();
  assert.equal(await historyButton.getAttribute('aria-busy'), 'false');
  assert.deepEqual(await historyButton.evaluate(node => ({ width: node.getBoundingClientRect().width, opacity: getComputedStyle(node).opacity })), historyControlBefore);
  assert.ok(Math.abs((await firstCurrent.boundingBox()).y - anchorBefore.y) < 2, 'Prepending must preserve the visible message despite streaming below');
  assert.equal(await originalCodeControl.evaluate(node => node.isConnected), true, 'Prepending must retain mounted rich content');
  assert.deepEqual(historyRequests, ['probe-1'], 'Restoring the anchor must not automatically fetch another page');
  const originalViewport = page.viewportSize();
  const remaining = await historyViewport.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  await page.setViewportSize({ width: originalViewport.width, height: Math.round(originalViewport.height + remaining - 80) });
  await historyViewport.evaluate(node => node.dispatchEvent(new Event('scroll')));
  const beforePoll = await firstCurrent.boundingBox();
  await page.waitForResponse(response => response.url().includes('/sessions/gate') && !response.url().includes('cursor'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(Math.abs((await firstCurrent.boundingBox()).y - beforePoll.y) < 2, 'Pagination correction must not enable bottom-follow on the next poll');
  await page.setViewportSize(originalViewport);
  await historyViewport.evaluate(node => { node.scrollTop = 0; });
  await page.getByText('Could not load older messages. Please retry.', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-message-id]').count(), 60, 'Failure must retain already-loaded messages');
  // Residual scrolling at the top must not repeatedly toggle Loading / Earlier messages.
  for (let i = 0; i < 3; i++) {
    await historyViewport.evaluate(node => {
      node.scrollTop = 24; node.dispatchEvent(new Event('scroll'));
      node.scrollTop = 12; node.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(100);
  }
  assert.deepEqual(historyRequests, ['probe-1', 'probe-2'], 'Top-edge movement after failure must not automatically retry history');
  await historyViewport.evaluate(node => {
    node.scrollTop = 120; node.dispatchEvent(new Event('scroll'));
    node.scrollTop = 12; node.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  assert.deepEqual(historyRequests, ['probe-1', 'probe-2'], 'A failed page must wait for explicit retry even on re-entry');
  failHistory = false;
  await page.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await page.getByText('ancient message 0', { exact: false }).waitFor();
  assert.equal(await page.locator('[data-message-id]').count(), 80, 'Overlapping pages must not duplicate messages');
  assert.equal(await page.getByRole('button', { name: 'Earlier messages', exact: true }).count(), 0, 'Stop when native pagination is exhausted');
  await historyViewport.evaluate(node => { node.scrollTop = 100; node.dispatchEvent(new Event('scroll')); node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  assert.deepEqual(historyRequests, ['probe-1', 'probe-2', 'probe-2']);
  await historyViewport.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
  const readingPosition = await historyViewport.evaluate(node => {
    node.scrollTop -= 40; node.dispatchEvent(new Event('scroll')); return node.scrollTop;
  });
  emit({ type: 'delta', itemId: 'current-39', delta: '\n\nOutput arriving while reading above the bottom.' });
  await page.getByText('Output arriving while reading above the bottom.', { exact: true }).waitFor();
  assert.ok(Math.abs(await historyViewport.evaluate(node => node.scrollTop) - readingPosition) < 2, 'A small upward scroll must stop bottom-follow during streaming');
  await historyViewport.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
  emit({ type: 'delta', itemId: 'current-39', delta: '\n\nOutput after returning to the bottom.' });
  await page.getByText('Output after returning to the bottom.', { exact: true }).waitFor();
  assert.ok(await historyViewport.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight) < 2, 'Scrolling back down must resume bottom-follow');
  // Native pages can contain only reasoning items, which Gate does not display.
  sparseHistory = true; historyRequests.length = 0;
  await page.reload();
  await page.getByText('current message 39', { exact: false }).waitFor();
  const sparsePage = page.waitForResponse(response => response.url().includes('cursor=probe-1'));
  await historyViewport.evaluate(node => { node.scrollTop = 40; });
  await sparsePage;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (let i = 0; i < 3; i++) {
    await historyViewport.evaluate(node => {
      node.scrollTop = 24; node.dispatchEvent(new Event('scroll'));
      node.scrollTop = 12; node.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(100);
  }
  assert.deepEqual(historyRequests, ['probe-1'], 'An empty page must not chain more requests while still in the top zone');
  await historyViewport.evaluate(node => {
    node.scrollTop = 120; node.dispatchEvent(new Event('scroll'));
    node.scrollTop = 40; node.dispatchEvent(new Event('scroll'));
  });
  await page.getByText('ancient message 0', { exact: false }).waitFor();
  assert.deepEqual(historyRequests, ['probe-1', 'probe-2'], 'Leaving and re-entering the top zone must load the next page');
  sparseHistory = false;
  historyProbe = false;
  await page.reload();
  await page.getByRole('button', { name: 'Earlier messages' }).click();
  await page.getByText('Earlier context.', { exact: true }).waitFor();
  // Attachments are drafts scoped to a session, then become native user-message content.
  const imageComposer = page.getByLabel('Message Codex');
  const imageInput = page.getByLabel('Image files', { exact: true });
  const previews = page.getByLabel('Image attachments', { exact: true });
  await imageInput.setInputFiles(imageFile);
  await previews.getByRole('img', { name: imageFile.name }).waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  const imageHash = await page.evaluate(() => location.hash);
  await page.evaluate(hash => { location.hash = hash.replace(/\/gate$/, '/website'); }, imageHash);
  await page.getByRole('heading', { name: 'website', exact: true }).waitFor();
  assert.equal(await previews.count(), 0, 'Attachment drafts cannot leak to another session');
  await page.evaluate(hash => { location.hash = hash; }, imageHash);
  await previews.getByRole('img', { name: imageFile.name }).waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  await imageComposer.fill('!pwd');
  assert.equal(await page.getByRole('button', { name: 'Run shell command', exact: true }).isDisabled(), true);
  await page.getByText('Remove image attachments before running a shell command.', { exact: true }).waitFor();
  await imageComposer.fill('Review this screenshot.');
  for (const width of [1365, 390, 320]) { await page.setViewportSize({ width, height: 844 }); await bounded(); }
  await shot('image-attachments-mobile');
  await page.route('**/sessions/gate/input', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Image request rejected' }) }));
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('alert').getByText('Image request rejected').waitFor();
  assert.equal(await previews.getByRole('img').count(), 1, 'A failed send retains image drafts');
  assert.equal(await imageComposer.inputValue(), 'Review this screenshot.');
  await page.unroute('**/sessions/gate/input');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Stop current turn' }).waitFor();
  assert.deepEqual(writes.at(-1).images, [imageUrl]);
  assert.equal(writes.at(-1).text, 'Review this screenshot.');
  assert.equal(await previews.count(), 0);
  const sentImage = page.getByRole('img', { name: 'Attached image 1', exact: true }).first();
  await sentImage.waitFor();
  await sentImage.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Attached image 1"]')].some(image => image.complete && image.naturalWidth > 0));
  assert.ok(await sentImage.evaluate(image => image.complete && image.naturalWidth > 0));
  await page.getByRole('button', { name: 'Preview image 1', exact: true }).click();
  await page.getByRole('dialog').getByRole('img').waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await sentImage.evaluate(image => { window.attachmentNode = image; });
  await page.waitForResponse(response => response.url().endsWith('/sessions/gate'));
  assert.equal(await sentImage.evaluate(image => image === window.attachmentNode), true, 'Polling must not remount images');
  // Use the system clipboard and a real keyboard paste, not only constructed ClipboardEvents.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    window.imagePastes = [];
    document.addEventListener('paste', event => window.imagePastes.push({ trusted: event.isTrusted, target: event.target.tagName }));
    document.activeElement?.blur();
  });
  const beforePaste = writes.length;
  await page.keyboard.press('Control+V');
  await previews.getByRole('img').waitFor();
  await page.waitForFunction(() => document.activeElement === document.querySelector('textarea') && !document.querySelector('textarea').disabled);
  assert.equal(await previews.getByRole('img').count(), 1, 'Clipboard items and files must not duplicate attachments');
  assert.deepEqual(await page.evaluate(() => window.imagePastes[0]), { trusted: true, target: 'BODY' });
  assert.equal(writes.length, beforePaste, 'Pasting only adds a draft, never sends a message');
  await previews.getByRole('button').click();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).focus();
  await page.keyboard.press('Control+V');
  assert.equal(await previews.count(), 0, 'Paste in another dialog must not attach to the conversation');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('Pasted notes'));
  await imageComposer.fill('Before '); await imageComposer.press('End'); await page.keyboard.press('Control+V');
  assert.equal(await imageComposer.inputValue(), 'Before Pasted notes', 'Normal text paste keeps the browser default');
  await imageComposer.fill('');
  for (const representation of ['items', 'files']) {
    await imageComposer.evaluate((input, { representation, bytes }) => {
      const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(bytes)], 'clipboard.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: {
        items: representation === 'items' ? transfer.items : [], files: representation === 'files' ? transfer.files : [],
      } });
      input.dispatchEvent(event);
    }, { representation, bytes: [...imageFile.buffer] });
    await previews.getByRole('img', { name: 'clipboard.png' }).waitFor();
    await previews.getByRole('button').click();
  }
  // Clipboard and drop work without navigating the page or inserting file paths as text.
  for (const type of ['paste', 'drop']) {
    await imageComposer.evaluate((input, { type, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(bytes)], `${type}.png`, { type: 'image/png' }));
      input.dispatchEvent(type === 'paste' ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    }, { type, bytes: [...imageFile.buffer] });
    await previews.getByRole('img', { name: `${type}.png` }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  }
  await page.getByRole('button', { name: 'Remove drop.png', exact: true }).click();
  assert.equal(await previews.getByRole('img').count(), 1);
  await imageInput.setInputFiles(Array(4).fill(imageFile));
  await page.getByRole('alert').getByText('Attach up to 4 images.').waitFor();
  assert.equal(await previews.getByRole('img').count(), 1);
  await imageInput.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await page.getByRole('alert').getByText('Cannot open invalid.png as an image.').waitFor();
  await imageInput.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await page.getByRole('alert').getByText('Each image must be 5 MB or smaller.').waitFor();
  await page.getByRole('button', { name: 'Send update', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  assert.deepEqual(writes.at(-1).images, [imageUrl]);
  assert.equal(writes.at(-1).text, '', 'Images can be sent without text');
  assert.equal(writes.at(-1).turnId, 'turn-two');
  await page.getByRole('button', { name: 'Stop current turn' }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Attach images', exact: true }).waitFor();
  assert.equal(await page.getByRole('img', { name: 'Attached image 1', exact: true }).count(), 2, 'Native history restores sent attachments');
  await page.getByRole('button', { name: 'Earlier messages' }).click();
  await page.getByText('Earlier context.', { exact: true }).waitFor();
  const reasoning = page.getByLabel('Reasoning effort', { exact: true });
  await reasoning.selectOption('high');
  await page.getByLabel('Model', { exact: true }).selectOption('fixture-other');
  assert.equal(await reasoning.inputValue(), '', 'Changing models resets the effort draft');
  assert.equal(await reasoning.getByRole('option', { name: 'High', exact: true }).count(), 0, 'Only show efforts supported by the selected model');
  await reasoning.selectOption('medium');
  await page.waitForResponse(response => response.url().includes('/sessions/gate') && !response.url().includes('cursor'));
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'fixture-other', 'Polling must retain an unsent model selection');
  assert.equal(await reasoning.inputValue(), 'medium', 'Polling must retain an unsent effort selection');
  const composer = page.getByLabel('Message Codex');
  await composer.fill('!');
  assert.equal(await page.getByRole('button', { name: 'Run shell command', exact: true }).isDisabled(), true);
  const beforeShell = writes.length;
  const shellCommand = 'printf shell-ok; printf shell-error >&2; exit 7';
  await composer.fill('!' + shellCommand);
  assert.equal(await page.getByLabel('Model', { exact: true }).count(), 0, 'Shell mode has no model picker');
  await composer.press('Enter');
  await page.getByText('shell-ok', { exact: true }).waitFor();
  await page.getByLabel('Standard error', { exact: true }).waitFor();
  await page.getByText('Exit 7', { exact: true }).waitFor();
  assert.deepEqual(writes.slice(beforeShell), [{ type: 'shell', serverId: server.id, threadId: 'gate', command: shellCommand }]);
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'fixture-other');
  assert.equal(await reasoning.inputValue(), 'medium', 'Shell execution preserves the next model turn settings');
  // A pending command belongs to its original session and is never submitted again after navigation.
  holdShell = true;
  const originalHash = await page.evaluate(() => location.hash);
  await composer.fill('!pwd');
  await page.getByRole('button', { name: 'Run shell command', exact: true }).click();
  await page.getByText('Running…', { exact: true }).waitFor();
  await page.evaluate(() => { location.hash = 'sessions'; });
  await page.getByRole('button', { name: 'Add server', exact: true }).waitFor();
  releaseShell(); holdShell = false;
  await page.evaluate(hash => { location.hash = hash; }, originalHash);
  await page.getByText('/home/alex/projects/gate', { exact: true }).waitFor();
  await page.getByText('Exit 0', { exact: true }).waitFor();
  assert.equal(writes.slice(beforeShell).filter(w => w.type === 'shell').length, 2);
  assert.equal(writes.slice(beforeShell).filter(w => w.type === 'input').length, 0, 'Shell commands must never reach LLM input');
  await composer.fill('english');
  const ime = await composer.evaluate(input => {
    let submits = 0;
    const onSubmit = () => { submits++; };
    input.form.addEventListener('submit', onSubmit);
    const enter = (options) => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...options });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const native = enter({ isComposing: true, keyCode: 13 });
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'english' }));
    const composing = enter({ isComposing: false, keyCode: 13 });
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'english' }));
    // Some browsers end composition before delivering the confirming Enter.
    const confirming = enter({ isComposing: false, keyCode: 229 });
    input.form.removeEventListener('submit', onSubmit);
    return { submits, native, composing, confirming, value: input.value };
  });
  assert.deepEqual(ime, { submits: 0, native: false, composing: false, confirming: false, value: 'english' });
  await composer.fill('Line one');
  await composer.press('Shift+Enter');
  await composer.press('End');
  assert.equal(await composer.inputValue(), 'Line one\n');
  await page.getByLabel('Message Codex').fill('Continue from the browser.');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Stop current turn' }).waitFor();
  assert.equal(writes.at(-1).turnId, null);
  assert.equal(writes.at(-1).model, 'fixture-other');
  assert.equal(writes.at(-1).effort, 'medium');
  assert.equal(await page.getByLabel('Model', { exact: true }).isDisabled(), true);
  assert.equal(await reasoning.isDisabled(), true);
  const beforeRunningShell = writes.length;
  await composer.fill('!pwd');
  assert.equal(await page.getByRole('button', { name: 'Stop current turn', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Run shell command', exact: true }).click();
  await page.getByRole('button', { name: 'Stop current turn', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  assert.equal(writes.length, beforeRunningShell + 1);
  assert.equal(writes.at(-1).type, 'shell', 'Even during an active turn, shell commands bypass steering');
  await page.getByLabel('Message Codex').fill('Use the existing theme.');
  await page.getByRole('button', { name: 'Send update', exact: true }).click();
  await page.getByText('Use the existing theme.', { exact: true }).waitFor();
  assert.equal(writes.at(-1).turnId, 'turn-two');
  assert.equal(writes.at(-1).model, undefined, 'Steering must not include a model override');
  assert.equal(writes.at(-1).effort, undefined, 'Steering must not include an effort override');
  await page.getByRole('button', { name: 'Stop current turn' }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(writes.at(-1).type, 'interrupt');
  // The monitor and all conversations share snapshots; switching preserves local work.
  await page.getByLabel('Message Codex').fill('Unsaved original draft');
  await page.getByLabel('Model', { exact: true }).selectOption('fixture-current');
  await reasoning.selectOption('high');
  const viewport = page.getByRole('region', { name: 'Conversation', exact: true });
  await viewport.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  assert.equal(await page.getByRole('button', { name: 'Dismiss session notice' }).count(), 0, 'Existing pending work must not toast on entry');
  sessions[1].state = 'waiting'; sessions[1].attentionReason = 'Waiting for approval';
  await page.getByRole('button', { name: 'View session', exact: true }).waitFor();
  assert.match(await page.getByRole('status').innerText(), /website/);
  await bounded(); await shot('attention-notice-mobile');
  await page.getByRole('button', { name: 'View session', exact: true }).click();
  await page.getByRole('heading', { name: 'website', exact: true }).waitFor();
  await page.getByLabel('Message Codex').fill('Separate website draft');
  await page.getByRole('button', { name: /^Return to 修复登录/ }).click();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Message Codex').inputValue(), 'Unsaved original draft');
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Model"]').disabled);
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'fixture-current');
  assert.equal(await reasoning.inputValue(), 'high');
  assert.equal(await viewport.evaluate(node => node.scrollTop), 0);
  const attentionButton = page.getByRole('button', { name: 'Other sessions: Needs you', exact: true });
  await attentionButton.click();
  await page.getByRole('button', { name: /website Development · Waiting for approval/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /修复登录 · Gate Development/ }).count(), 0, 'Exclude the current session');
  for (const width of [1365, 390, 320]) { await page.setViewportSize({ width, height: 844 }); await bounded(); }
  await shot('attention-list-mobile');
  await page.getByRole('button', { name: /website Development · Waiting for approval/ }).click();
  assert.equal(await page.getByLabel('Message Codex').inputValue(), 'Separate website draft');
  await page.getByRole('button', { name: /^Next needs you/ }).click();
  await page.getByRole('heading', { name: 'api', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Return to 修复登录/ }).click();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await page.getByRole('button', { name: 'View session', exact: true }).count(), 0, 'Polling must not repeat alerts');
  monitor.servers[0].state = 'error';
  await attentionButton.click();
  await page.getByText('Some servers are unavailable; their status is unknown.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close session list' }).click();
  monitor.servers[0].state = 'connected';
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await page.getByRole('button', { name: 'View session', exact: true }).count(), 0, 'Reconnection must not repeat alerts');
  sessions[1].state = 'error'; sessions[1].attentionReason = 'Session error';
  await page.getByRole('button', { name: 'View session', exact: true }).waitFor();
  assert.match(await page.getByRole('status').innerText(), /Session error/);
  await page.getByRole('button', { name: 'Dismiss session notice', exact: true }).click();
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await page.getByRole('button', { name: 'View session', exact: true }).count(), 0, 'Dismissed pending work must not toast again');
  sessions[1].state = 'running'; delete sessions[1].attentionReason;
  await page.getByLabel('Message Codex').fill('');
  await reasoning.selectOption('');
  await page.getByLabel('Model', { exact: true }).selectOption('');
  assert.equal(await reasoning.getByRole('option', { selected: true }).textContent(), 'Current: medium');
  const writesBeforeSwitch = writes.length;
  holdInput = true;
  await imageInput.setInputFiles(imageFile);
  await previews.getByRole('img').waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea').disabled);
  await page.getByLabel('Message Codex').fill('Pending switch check');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await attentionButton.click();
  await page.getByRole('button', { name: /api Development · Waiting for you/ }).click();
  await page.getByRole('heading', { name: 'api', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Return to 修复登录/ }).click();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true, 'A pending send stays pending across switches');
  holdInput = false; releaseInput();
  await page.getByRole('button', { name: 'Stop current turn', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Message Codex').inputValue(), '', 'Confirmed send clears the original draft');
  assert.equal(writes.slice(writesBeforeSwitch).filter(w => w.type === 'input').length, 1, 'Switching must not replay pending sends');
  assert.deepEqual(writes.at(-1).images, [imageUrl]);
  assert.equal(await previews.count(), 0, 'Confirmed send clears attachments even after switching away and back');
  await page.getByRole('button', { name: 'Stop current turn', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  modelsUnavailable = true;
  await page.reload();
  await page.getByText('Catalog unavailable', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Message Codex').isEnabled(), true, 'Catalog failure must not disable chat');
  modelsUnavailable = false;
  await page.getByRole('button', { name: 'Retry models', exact: true }).click();
  await page.getByLabel('Model', { exact: true }).selectOption('fixture-current');
  detail.requests = [{ id: 'approval', threadId: 'gate', kind: 'approval', title: 'Allow this command?', detail: 'npm test', choices: ['accept', 'decline'], questions: [], answering: false }]; emit();
  await page.getByRole('button', { name: 'Allow once' }).click();
  await page.getByText('Allow this command?', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).decision, 'accept');
  detail.requests = [{ id: 'question', threadId: 'gate', kind: 'question', title: 'Codex needs your answer', detail: '', choices: [],
    questions: [{ id: 'scope', text: 'Which repository?', options: ['Current'], secret: false }], answering: false }]; emit();
  await page.getByLabel('Which repository?').fill('Current');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await page.getByLabel('Which repository?').waitFor({ state: 'hidden' });
  assert.deepEqual(writes.at(-1).answers, { scope: 'Current' });
  await bounded(); await shot('chat-mobile');
  const beforeReconnect = writes.length;
  for (const socket of wss.clients) socket.close();
  await page.getByRole('button', { name: 'Session details', exact: true }).click();
  await page.getByText('Reconnecting…', { exact: true }).waitFor();
  await page.getByText('Idle', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(writes.length, beforeReconnect, 'Reconnect must never replay writes');
  await page.getByRole('button', { name: 'All sessions' }).click();
  await page.getByRole('button', { name: 'New session on Development' }).click();
  assert.equal(await page.getByLabel('Working directory').inputValue(), server.defaultWorkingDir);
  await page.getByLabel('What should Codex do?').fill('Add a focused regression test.');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.getByText('Add a focused regression test.', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { type: 'create', cwd: server.defaultWorkingDir, prompt: 'Add a focused regression test.' });
  assert.equal(new URL(page.url()).hash, `#session/${server.id}/created`);
  await bounded();
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: persistent filters, archive/restore, project grouping, collapsed history, search, monitor, history, create, send, steer, interrupt, approvals, questions, reconnect, 320/390/1365px.');
} catch (error) {
  await shot('failure');
  console.error(await page.locator('body').innerText());
  console.error(errors);
  throw error;
} finally {
  await browser.close(); for (const socket of wss.clients) socket.terminate();
  await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve)); db.close();
}
