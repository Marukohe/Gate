import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import express, { Router } from 'express';

const lifetime = 30 * 24 * 60 * 60;
export const validToken = (value: unknown): value is string => typeof value === 'string' && /^[!-~]{1,512}$/.test(value);

export function loadAccessToken(dataDir: string, configured = process.env.GATE_TOKEN) {
  const file = path.join(dataDir, 'token');
  if (configured !== undefined) {
    if (!validToken(configured)) throw new Error('GATE_TOKEN must be 1–512 printable characters without spaces.');
    return { token: configured, source: 'GATE_TOKEN' };
  }
  try {
    writeFileSync(file, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const token = readFileSync(file, 'utf8').trim();
  if (!validToken(token)) throw new Error('Gate token file is invalid.');
  return { token, source: file };
}

function sameOrigin(req: IncomingMessage) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === req.headers.host;
  } catch { return false; }
}

const hash = (text: string) => createHash('sha256').update(text).digest();
export function gateAuth(token: string, instanceId: string) {
  const digest = hash(token);
  const matches = (value: unknown) => validToken(value) && timingSafeEqual(hash(value), digest);
  const cookie = `gate_session_${hash(instanceId).toString('hex').slice(0, 16)}`;
  const signature = (expiry: string) => createHmac('sha256', token).update(`gate-browser:${instanceId}:${expiry}`).digest('base64url');
  const auth = (req: IncomingMessage) => {
    if (!sameOrigin(req)) return false;
    if (req.headers.authorization?.startsWith('Bearer ')) return matches(req.headers.authorization.slice(7));
    const entry = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(cookie + '='));
    const value = entry?.slice(cookie.length + 1).match(/^(\d{10})\.([A-Za-z0-9_-]{43})$/);
    return !!value && Number(value[1]) > Math.floor(Date.now() / 1000) &&
      timingSafeEqual(Buffer.from(value[2]), Buffer.from(signature(value[1])));
  };

  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Sign in from this Gate address.' });
    next();
  });
  router.get('/auth', (req, res) => res.json({ authenticated: auth(req) }));
  router.post('/auth', express.json({ limit: '2kb' }), (req, res) => {
    if (!matches(req.body?.token)) return res.status(401).json({ error: 'Invalid access token.' });
    const expiry = String(Math.floor(Date.now() / 1000) + lifetime);
    res.cookie(cookie, `${expiry}.${signature(expiry)}`, {
      httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers.origin?.startsWith('https://'),
      path: '/', maxAge: lifetime * 1000,
    });
    res.sendStatus(204);
  });
  router.delete('/auth', (_req, res) => {
    res.clearCookie(cookie, { httpOnly: true, sameSite: 'strict', path: '/' });
    res.sendStatus(204);
  });
  router.use((req, res, next) => {
    if (!auth(req)) return res.status(401).json({ error: 'Access token required.' });
    next();
  });
  return { router, auth };
}
