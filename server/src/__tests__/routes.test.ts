import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { createDb } from '../db.js';
import { routes } from '../routes.js';
import type { AgentService } from '../agents.js';
import { INPUT_BODY_LIMIT } from '../images.js';

let db: ReturnType<typeof createDb>;
let http: HttpServer;
let origin: string;
const codex = { tools: () => [
  { id: 'codex', name: 'Codex', executable: 'codex', description: '' },
  { id: 'agy', name: 'Antigravity', executable: 'agy', description: '' },
], sync: vi.fn(), monitor: vi.fn(), create: vi.fn(), input: vi.fn(), rename: vi.fn(), models: vi.fn(), file: vi.fn(), directory: vi.fn(), shell: vi.fn() };
const hosts = { list: vi.fn(), resolve: vi.fn() };
beforeEach(async () => {
  vi.resetAllMocks(); db = createDb(':memory:');
  const app = express(); app.use(express.json({ limit: INPUT_BODY_LIMIT })); app.use(routes(db, codex as unknown as AgentService, hosts));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: error.message }));
  http = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => http.once('listening', resolve));
  const address = http.address(); origin = `http://127.0.0.1:${typeof address === 'object' && address?.port}`;
});
afterEach(async () => { await new Promise<void>((resolve) => http.close(() => resolve())); db.close(); });
const send = (path: string, body: object, method = 'POST') => fetch(origin + path,
  { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

it('lists local SSH hosts and imports resolved fields without connecting to a tool', async () => {
  hosts.list.mockResolvedValue(['development']);
  hosts.resolve.mockResolvedValue({ alias: 'development', host: '127.0.0.1', port: 2222, username: 'tester', identityFiles: ['/keys/test'] });
  expect(await (await fetch(origin + '/ssh/hosts')).json()).toEqual({ hosts: ['development'] });
  expect(await (await fetch(origin + '/ssh/hosts/development')).json()).toMatchObject({ port: 2222, identityFiles: ['/keys/test'] });
  expect(hosts.resolve).toHaveBeenCalledWith('development'); expect(codex.create).not.toHaveBeenCalled();
  hosts.resolve.mockRejectedValue(new Error('Host is no longer configured'));
  expect((await fetch(origin + '/ssh/hosts/deleted')).status).toBe(400);
  expect(db.listServers()).toEqual([]);
});

it('exposes registered tools, persists separate tool connections, and preserves legacy executable settings', async () => {
  expect((await (await fetch(origin + '/tools')).json()).tools.map((tool: any) => tool.id)).toEqual(['codex', 'agy']);
  const fields = { name: 'Same server', host: 'localhost', username: 'user', authType: 'password', password: 'private', port: 22 };
  const legacy = await (await send('/servers', { ...fields, codexPath: '/old/codex' })).json();
  expect(legacy).toMatchObject({ tool: 'codex', executablePath: '/old/codex', hasPassword: true });
  const agy = await (await send('/servers', { ...fields, tool: 'agy', executablePath: '/tools/agy' })).json();
  expect(agy).toMatchObject({ tool: 'agy', executablePath: '/tools/agy', hasPassword: true });
  expect(agy.password).toBeUndefined(); expect(agy.id).not.toBe(legacy.id);
  expect((await send(`/servers/${agy.id}`, { ...fields, password: '', tool: 'agy', executablePath: '/new/agy' }, 'PUT')).status).toBe(200);
  expect(db.getServer(agy.id)).toMatchObject({ password: 'private', executablePath: '/new/agy' });
  expect((await send(`/servers/${legacy.id}`, { ...fields, tool: 'agy' }, 'PUT')).status).toBe(400);
  expect((await send('/servers', { ...fields, tool: 'unknown' })).status).toBe(400);
});

it('validates session names before sending a native rename and surfaces failures', async () => {
  const path = '/servers/server/sessions/native/rename';
  for (const name of ['', '  ', 'x'.repeat(1001), 'bad\0name', 42]) {
    expect((await send(path, { name })).status).toBe(400);
  }
  expect(codex.rename).not.toHaveBeenCalled();
  expect((await send(path, { name: '  Fix login  ' })).status).toBe(200);
  expect(codex.rename).toHaveBeenCalledWith('server', 'native', 'Fix login');
  codex.rename.mockRejectedValueOnce(new Error('Disconnected'));
  expect(await (await send(path, { name: 'Retry later' })).json()).toEqual({ error: 'Disconnected' });
});

it('lists server models and validates optional model overrides before input', async () => {
  codex.models.mockResolvedValue([{ id: 'model-two', name: 'Model Two' }]);
  expect(await (await fetch(origin + '/servers/server/models')).json()).toEqual({ models: [{ id: 'model-two', name: 'Model Two' }] });
  expect(codex.models).toHaveBeenCalledWith('server', undefined);
  const path = '/servers/server/sessions/native/input';
  for (const model of ['', ' ', 42, 'bad\0model', 'x'.repeat(201)]) {
    expect((await send(path, { text: 'Work', model })).status).toBe(400);
  }
  expect(codex.input).not.toHaveBeenCalled();
  expect((await send(path, { text: 'Work', model: 'model-two' })).status).toBe(200);
  expect(codex.input).toHaveBeenCalledWith('server', 'native', 'Work', undefined, 'model-two', undefined, undefined);
  codex.input.mockClear();
  for (const effort of ['', ' ', 42, 'bad\0effort', 'x'.repeat(51)]) {
    expect((await send(path, { text: 'Work', effort })).status).toBe(400);
  }
  expect(codex.input).not.toHaveBeenCalled();
  expect((await send(path, { text: 'Work', effort: 'high' })).status).toBe(200);
  expect(codex.input).toHaveBeenCalledWith('server', 'native', 'Work', undefined, undefined, 'high', undefined);
});

it('accepts image-only input above the old JSON body limit and retains text validation', async () => {
  const path = '/servers/server/sessions/native/input';
  const images = ['data:image/png;base64,' + Buffer.alloc(1024 * 1024).toString('base64')];
  expect((await send(path, { images })).status).toBe(200);
  expect(codex.input).toHaveBeenCalledWith('server', 'native', '', undefined, undefined, undefined, images);
  for (const text of [42, null, 'bad\0text', 'x'.repeat(200001)]) expect((await send(path, { text, images: [] })).status).toBe(400);
  codex.input.mockRejectedValueOnce(new Error('Invalid image data.'));
  expect(await (await send(path, { text: '', images: ['bad'] })).json()).toEqual({ error: 'Invalid image data.' });
});

it('preserves a saved password on edit without exposing it in any settings response', async () => {
  const fields = { name: 'Local', host: 'localhost', username: 'test', authType: 'password', port: 22 };
  const created = await (await send('/servers', { ...fields, password: 'private-test-value' })).json();
  expect(created.password).toBeUndefined(); expect(created.hasPassword).toBe(true);
  const updated = await (await send(`/servers/${created.id}`, { ...fields, name: 'Renamed', password: '' }, 'PUT')).json();
  expect(updated.password).toBeUndefined(); expect(updated.hasPassword).toBe(true);
  expect(db.getServer(created.id)?.password).toBe('private-test-value');
  expect(await (await fetch(origin + '/servers')).text()).not.toContain('private-test-value');
  expect((await send('/servers', { ...fields, port: 0 })).status).toBe(400);
});

it('validates before creation and returns the created native thread when its first input fails', async () => {
  expect((await send('/servers/server/sessions', { cwd: '/repo', prompt: ' ' })).status).toBe(400);
  expect((await send('/servers/server/sessions', { cwd: 'relative', prompt: 'Work' })).status).toBe(400);
  expect(codex.create).not.toHaveBeenCalled();
  codex.create.mockResolvedValue({ id: 'native' });
  codex.input.mockRejectedValue(new Error('Connection lost; check before retrying'));
  const response = await send('/servers/server/sessions', { cwd: '/repo', prompt: 'Work' });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ session: { id: 'native' }, error: 'Connection lost; check before retrying' });
  expect(codex.create).toHaveBeenCalledTimes(1); expect(codex.input).toHaveBeenCalledTimes(1);
});


it('applies persistent filters and archives to monitor responses without invoking Codex mutations', async () => {
  const fields = { name: 'Local', host: 'localhost', port: 22, username: 'test', authType: 'password' as const };
  const a = db.createServer(fields); const b = db.createServer(fields);
  codex.monitor.mockReturnValue({ servers: [a, b].map((server) => ({ id: server.id, sessions: [
    { id: 'inside', cwd: '/repo/src', name: 'Inside', state: 'running' },
    { id: 'outside', cwd: '/repo-other', name: 'Outside', state: 'idle' },
  ] })) });
  const visibility = `/servers/${a.id}/visibility`;
  expect((await send(visibility, { excludedDirectories: ['/repo/'] }, 'PUT')).status).toBe(200);
  const snapshot = async () => (await (await fetch(origin + '/monitor')).json()).servers;
  expect((await snapshot())[0].sessions.map((s: any) => s.id)).toEqual(['outside']);
  expect((await snapshot())[1].sessions).toHaveLength(2);
  const archive = `/servers/${a.id}/sessions/outside/archive`;
  expect((await send(archive, { name: 'Outside', cwd: '/repo-other' })).status).toBe(200);
  expect((await snapshot())[0]).toMatchObject({ sessions: [], hasFilters: true });
  expect(await (await fetch(origin + visibility)).json()).toMatchObject({
    directories: ['/repo', '/repo-other', '/repo/src'], excludedDirectories: ['/repo'], archivedSessions: [{ id: 'outside' }],
  });
  await send(visibility, { excludedDirectories: [] }, 'PUT');
  expect((await snapshot())[0].sessions.map((s: any) => s.id)).toEqual(['inside']);
  expect((await fetch(origin + archive, { method: 'DELETE' })).status).toBe(204);
  expect((await snapshot())[0]).toMatchObject({ hasFilters: false });
  expect((await snapshot())[0].sessions).toHaveLength(2);
  expect((await send(visibility, { excludedDirectories: ['relative'] }, 'PUT')).status).toBe(400);
  expect((await fetch(origin + '/servers/missing/visibility')).status).toBe(404);
  expect(codex.sync).toHaveBeenCalledTimes(1);
  expect(codex.create).not.toHaveBeenCalled(); expect(codex.input).not.toHaveBeenCalled();
});

it('serves inert text with line anchors, images, downloads, and readable file errors', async () => {
  const path = '/servers/remote/sessions/native/file?path=src%2Ffile.ts';
  codex.file.mockResolvedValue({ path: '/remote/src/file.ts', data: Buffer.from('first\n<script>window.bad = true</script>') });
  const response = await fetch(origin + path);
  expect(codex.file).toHaveBeenCalledWith('remote', 'native', 'src/file.ts');
  const html = await response.text();
  expect(html).toContain('id="L2"');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('cache-control')).toBe('no-store');
  codex.file.mockResolvedValue({ path: '/tmp/chart.png', data: Buffer.from([137, 80, 78, 71]) });
  const image = await fetch(origin + path);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));
  codex.file.mockResolvedValue({ path: '/tmp/archive.bin', data: Buffer.from([0, 255]) });
  const download = await fetch(origin + path);
  expect(download.headers.get('content-disposition')).toContain('attachment');
  codex.file.mockRejectedValueOnce(new Error('No such file'));
  const missing = await fetch(origin + path);
  expect(missing.status).toBe(400);
  expect(await missing.text()).toContain('Cannot open file. No such file');
});

it('validates direct shell commands and never forwards them to model input', async () => {
  const path = '/servers/server/sessions/native/shell';
  for (const command of ['', '  ', 42, 'bad\0command', 'x'.repeat(32001)]) {
    expect((await send(path, { command })).status).toBe(400);
  }
  expect(codex.shell).not.toHaveBeenCalled();
  codex.shell.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0, timedOut: false, truncated: false });
  expect(await (await send(path, { command: 'pwd | head' })).json()).toMatchObject({ stdout: 'ok', exitCode: 0 });
  expect(codex.shell).toHaveBeenCalledWith('server', 'native', 'pwd | head');
  expect(codex.input).not.toHaveBeenCalled(); expect(codex.create).not.toHaveBeenCalled();
});


it('lists and previews session files without mutating native sessions, preserving exact path bytes', async () => {
  const path = '/servers/remote/sessions/native';
  codex.directory.mockResolvedValue({ path: '/repo', cwd: '/repo', entries: [], truncated: false });
  const listing = await fetch(origin + path + '/files');
  expect(listing.headers.get('cache-control')).toBe('no-store');
  expect(codex.directory).toHaveBeenCalledWith('remote', 'native', '.');
  expect(await listing.json()).toMatchObject({ path: '/repo', entries: [] });
  for (const query of ['?path=', '?path=a&path=b', '?path=bad%00path']) {
    expect((await fetch(origin + path + '/files' + query)).status).toBe(400);
  }
  const filename = '/repo/ 文档 #1 %.html ';
  const query = new URLSearchParams({ path: filename, view: 'preview' });
  codex.file.mockResolvedValue({ path: filename, data: Buffer.from('<script>window.bad = true</script>') });
  const preview = await fetch(origin + path + '/file?' + query);
  expect(await preview.json()).toMatchObject({ path: filename, kind: 'text', text: '<script>window.bad = true</script>' });
  expect(codex.file).toHaveBeenCalledWith('remote', 'native', filename);
  const download = await fetch(origin + path + '/file?' + new URLSearchParams({ path: filename, download: '1' }));
  expect(download.headers.get('content-disposition')).toMatch(/^attachment/);
  expect(download.headers.get('content-security-policy')).toContain('sandbox');
  codex.file.mockRejectedValueOnce(new Error('Permission denied'));
  expect(await (await fetch(origin + path + '/file?' + query)).json()).toEqual({ error: 'Cannot open file. Permission denied' });
  expect(codex.input).not.toHaveBeenCalled(); expect(codex.create).not.toHaveBeenCalled(); expect(codex.shell).not.toHaveBeenCalled();
});
