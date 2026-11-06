import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';

// Isolated native-session fixtures: no SSH connections or real user conversations.
const server = { id: 'dev', name: 'Development', host: 'dev.local', username: 'alex', port: 22,
  authType: 'privateKey', privateKeyPath: '~/.ssh/id_ed25519', defaultWorkingDir: '/home/alex/projects/gate', hasPassword: false };
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
let detail = { session: sessions[2], items: [{ id: 'u1', kind: 'user', text: 'Simplify the session panel.' },
  { id: 'a1', kind: 'assistant', text: 'The panel now groups sessions by server.\n\n- Running work stays visible.\n- Questions appear in the conversation.\n- Each session has one place to continue.' }],
  nextCursor: 'older', turnId: null, requests: [] };
const writes = [];
const app = express(); app.use(express.json());
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });
const emit = (event = {}) => { for (const socket of wss.clients) socket.send(JSON.stringify({ serverId: 'dev', threadId: detail.session.id, type: 'changed', ...event })); };
app.get('/api/servers', (_req, res) => res.json([server]));
app.get('/api/monitor', (_req, res) => res.json(monitor));
app.get('/api/servers/:id/sessions/:thread', (req, res) => res.json(req.query.cursor
  ? { ...detail, items: [{ id: 'old', kind: 'user', text: 'Earlier context.' }], nextCursor: null } : detail));
app.post('/api/servers/:id/sessions', (req, res) => {
  writes.push({ type: 'create', ...req.body });
  detail = { ...detail, session: { ...session('created', 'gate', 'running', req.body.prompt), cwd: req.body.cwd },
    items: [{ id: 'first', kind: 'user', text: req.body.prompt }], turnId: 'turn-one', nextCursor: null };
  res.status(201).json({ session: detail.session });
});
app.post('/api/servers/:id/sessions/:thread/input', (req, res) => {
  writes.push({ type: 'input', ...req.body });
  detail.items.push({ id: `message-${writes.length}`, kind: 'user', text: req.body.text });
  detail.turnId = 'turn-two'; detail.session.state = 'running'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/interrupt', (req, res) => {
  writes.push({ type: 'interrupt', ...req.body }); detail.turnId = null; detail.session.state = 'idle'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/requests/:request', (req, res) => {
  writes.push({ type: 'answer', ...req.body }); detail.requests = []; res.json({}); emit();
});
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
  const project = page.getByRole('group', { name: 'Project /home/alex/projects/api', exact: true });
  assert.equal(await page.getByRole('group', { name: 'Project /home/alex/worktrees/api-fix', exact: true }).count(), 0);
  await project.getByRole('button', { name: /Validate migrations/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^gate Idle/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Past API session/ }).count(), 0);
  assert.match(await page.getByRole('group').first().getAttribute('aria-label'), /projects\/api$/);
  await page.getByRole('button', { name: 'Show all sessions in api (archive)' }).waitFor();
  const heading = project.getByRole('heading', { name: 'Show all sessions in api (projects)' });
  assert.equal(await heading.getByRole('button').getAttribute('title'), '/home/alex/projects/api');
  assert.equal(await project.getByText('/home/alex/projects/api', { exact: true }).count(), 0);
  assert.equal(await project.getByText('Show 12 past sessions', { exact: true }).count(), 0);
  await heading.getByRole('button').focus();
  await page.keyboard.press('Enter');
  assert.equal(await project.getByRole('button', { name: /Past API session/ }).count(), 12);
  await page.waitForResponse(response => response.url().endsWith('/api/monitor'));
  assert.equal(await project.getByRole('button', { name: /Past API session/ }).count(), 12);
  await project.getByRole('button', { name: 'Show active sessions in api (projects)' }).click();
  await project.getByRole('button', { name: /Validate migrations/ }).waitFor();
  await page.getByLabel('Search sessions').fill('Migration notes 7');
  await page.getByRole('button', { name: /Past API session 7/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Show all sessions in api (projects)' }).count(), 0);
  await page.getByLabel('Search sessions').fill('');
  assert.equal(await page.getByRole('button', { name: /Past API session/ }).count(), 0);
  await page.getByLabel('Search sessions').blur();
  await shot('session-monitor');
  for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await bounded(); }
  await shot('monitor-mobile');
  const savedProject = page.getByRole('group', { name: 'Project /home/alex/projects/gate', exact: true });
  assert.ok((await savedProject.boundingBox()).height <= 52, 'An inactive project should occupy one row');
  await savedProject.getByRole('button', { name: 'Show all sessions in gate' }).click();
  await savedProject.getByRole('button', { name: /^gate Idle/ }).waitFor();
  await savedProject.getByRole('button', { name: 'Show active sessions in gate' }).click();
  await page.getByLabel('Search sessions').fill('gate');
  await page.getByRole('button', { name: /^gate Idle/ }).click();
  await page.getByText('The panel now groups sessions by server.').waitFor();
  await page.getByRole('button', { name: 'Earlier messages' }).click();
  await page.getByText('Earlier context.', { exact: true }).waitFor();
  await page.getByLabel('Message Codex').fill('Continue from the browser.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Stop current turn' }).waitFor();
  assert.equal(writes.at(-1).turnId, null);
  await page.getByLabel('Message Codex').fill('Use the existing theme.');
  await page.getByRole('button', { name: 'Send update', exact: true }).click();
  await page.getByText('Use the existing theme.', { exact: true }).waitFor();
  assert.equal(writes.at(-1).turnId, 'turn-two');
  await page.getByRole('button', { name: 'Stop current turn' }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(writes.at(-1).type, 'interrupt');
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
  await page.getByText('Reconnecting…', { exact: true }).waitFor();
  await page.getByText('Idle', { exact: true }).waitFor();
  assert.equal(writes.length, beforeReconnect, 'Reconnect must never replay writes');
  await page.getByRole('button', { name: 'All sessions' }).click();
  await page.getByRole('button', { name: 'New session on Development' }).click();
  assert.equal(await page.getByLabel('Working directory').inputValue(), server.defaultWorkingDir);
  await page.getByLabel('What should Codex do?').fill('Add a focused regression test.');
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.getByText('Add a focused regression test.', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { type: 'create', cwd: server.defaultWorkingDir, prompt: 'Add a focused regression test.' });
  assert.match(page.url(), /#session\/dev\/created$/);
  await bounded();
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: project grouping, collapsed history, search, monitor, history, create, send, steer, interrupt, approvals, questions, reconnect, 320/390/1365px.');
} finally {
  await browser.close(); for (const socket of wss.clients) socket.terminate();
  await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve));
}
