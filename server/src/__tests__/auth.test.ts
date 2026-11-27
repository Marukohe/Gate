import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { expect, it } from 'vitest';
import { gateAuth, loadAccessToken } from '../auth.js';

it('creates a private persistent token file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-auth-'));
  try {
    const first = loadAccessToken(dir, undefined);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loadAccessToken(dir, undefined)).toEqual(first);
    expect(statSync(first.source).mode & 0o777).toBe(0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('protects HTTP and verifies a persistent cookie without exposing the token', async () => {
  const token = 'fixture-gate-access-token';
  const app = express();
  app.use('/api', gateAuth(token, 'gate-one').router);
  app.get('/api/servers', (_req, res) => res.json([]));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const login = (token: string, origin = new URL(base).origin) => fetch(base + '/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ token }),
  });
  try {
    expect((await fetch(base + '/servers')).status).toBe(401);
    expect((await login('wrong')).status).toBe(401);
    expect((await login(token, 'https://elsewhere.test')).status).toBe(403);
    const loggedIn = await login(token);
    const setCookie = loggedIn.headers.get('set-cookie')!;
    expect(loggedIn.status).toBe(204);
    expect(setCookie).toMatch(/Max-Age=2592000/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain(token);
    const Cookie = setCookie.split(';')[0];
    expect(await (await fetch(base + '/auth', { headers: { Cookie } })).json()).toEqual({ authenticated: true });
    expect((await fetch(base + '/servers', { headers: { Cookie } })).status).toBe(200);
    expect((await fetch(base + '/servers', { headers: { Cookie, Origin: 'https://elsewhere.test' } })).status).toBe(403);
    expect((await fetch(base + '/servers', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    const logout = await fetch(base + '/auth', { method: 'DELETE', headers: { Cookie } });
    expect(logout.headers.get('set-cookie')).toMatch(/gate_session_.+=;.*Expires=Thu, 01 Jan 1970/);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
