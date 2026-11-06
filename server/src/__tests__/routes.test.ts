import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { createDb } from '../db.js';
import { routes } from '../routes.js';
import type { CodexService } from '../codex.js';

let db: ReturnType<typeof createDb>;
let http: HttpServer;
let origin: string;
const codex = { sync: vi.fn(), monitor: vi.fn(), create: vi.fn(), input: vi.fn() };
beforeEach(async () => {
  vi.resetAllMocks(); db = createDb(':memory:');
  const app = express(); app.use(express.json()); app.use(routes(db, codex as unknown as CodexService));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(400).json({ error: error.message }));
  http = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => http.once('listening', resolve));
  const address = http.address(); origin = `http://127.0.0.1:${typeof address === 'object' && address?.port}`;
});
afterEach(async () => { await new Promise<void>((resolve) => http.close(() => resolve())); db.close(); });
const send = (path: string, body: object, method = 'POST') => fetch(origin + path,
  { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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
