import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { chromium } from 'playwright';
import { createDb } from '../server/dist/db.js';
import { routes } from '../server/dist/routes.js';
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
const app = express(); app.use(express.json());
const http = createServer(app);
const wss = new WebSocketServer({ server: http, path: '/ws' });
const emit = (event = {}) => { for (const socket of wss.clients) socket.send(JSON.stringify({ serverId: server.id, threadId: detail.session.id, type: 'changed', ...event })); };
app.get('/api/servers', (_req, res) => res.json([server]));
app.get('/api/servers/:id/models', (_req, res) => modelsUnavailable
  ? res.status(503).json({ error: 'Catalog unavailable' })
  : res.json({ models: [
    { id: 'fixture-current', name: 'Current', defaultEffort: 'medium', efforts: [{ id: 'medium', description: '' }, { id: 'high', description: 'Deeper thinking' }] },
    { id: 'fixture-other', name: 'Other model', defaultEffort: 'low', efforts: [{ id: 'low', description: '' }, { id: 'medium', description: '' }] },
  ] }));

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
  if (req.body.model) detail.session.model = req.body.model;
  if (req.body.effort) detail.session.effort = req.body.effort;
  detail.items.push({ id: `message-${writes.length}`, kind: 'user', text: req.body.text });
  detail.turnId = 'turn-two'; detail.session.state = 'running'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/interrupt', (req, res) => {
  writes.push({ type: 'interrupt', ...req.body }); detail.turnId = null; detail.session.state = 'idle'; res.json({}); emit();
});
app.post('/api/servers/:id/sessions/:thread/requests/:request', (req, res) => {
  writes.push({ type: 'answer', ...req.body }); detail.requests = []; res.json({}); emit();
});
app.use('/api', routes(db, { sync() {}, monitor: () => structuredClone(monitor), async rename(serverId, threadId, name) {
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
  assert.match(await page.getByRole('group').first().getAttribute('aria-label'), /projects\/api$/);
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
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('Do not save');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(writes.some(w => w.type === 'rename'), false);
  await page.getByRole('button', { name: 'Rename session', exact: true }).click();
  await page.getByLabel('Session name', { exact: true }).fill('修复登录 · Gate');
  await bounded(); await shot('rename-mobile');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '修复登录 · Gate', exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { type: 'rename', serverId: server.id, threadId: 'gate', name: '修复登录 · Gate' });
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
  await page.getByLabel('Message Codex').fill('Use the existing theme.');
  await page.getByRole('button', { name: 'Send update', exact: true }).click();
  await page.getByText('Use the existing theme.', { exact: true }).waitFor();
  assert.equal(writes.at(-1).turnId, 'turn-two');
  assert.equal(writes.at(-1).model, undefined, 'Steering must not include a model override');
  assert.equal(writes.at(-1).effort, undefined, 'Steering must not include an effort override');
  await page.getByRole('button', { name: 'Stop current turn' }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
  assert.equal(writes.at(-1).type, 'interrupt');
  assert.equal(await reasoning.getByRole('option', { selected: true }).textContent(), 'Current: medium');
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
