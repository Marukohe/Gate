import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server as HttpServer } from 'node:http';
import { createDb } from '../db.js';
import { routes } from '../routes.js';
import type { CodexService } from '../codex.js';

let db: ReturnType<typeof createDb>;
let http: HttpServer;
let origin: string;
const codex = { sync: vi.fn(), create: vi.fn(), input: vi.fn() };
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
