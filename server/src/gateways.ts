import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type RequestHandler } from 'express';
import { WebSocket } from 'ws';
import { validToken } from './auth.js';
import type { Database, GatewayConnection } from './db.js';
import type { Gateway, GatewayStatus, MonitorServer, PublicServer, ServerEvent } from './types.js';

const protocol = 1;
const publicGateway = ({ id, name, url }: GatewayConnection): Gateway => ({ id, name, url });
const qualified = (peer: GatewayConnection, id: string) => `${peer.id}~${id}`;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;

function gatewayUrl(value: unknown) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value.trim());
      if (['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.username &&
          !url.password && !url.search && !url.hash) return url.origin;
    } catch { /* Report the expected address format below. */ }
  }
  throw new Error('Enter the HTTP or HTTPS address of another Gate.');
}

async function peerJson<T>(peer: Pick<GatewayConnection, 'url' | 'token'>, path: string) {
  let response: globalThis.Response;
  try {
    response = await fetch(peer.url + path, {
      headers: { Authorization: `Bearer ${peer.token}` }, redirect: 'error', signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) return await response.json() as T;
  } catch { throw new Error('Could not reach the Gate API.'); }
  await response.body?.cancel();
  throw new Error(response.status === 401 || response.status === 403 ? 'Gate rejected its access token.' : `Gate API returned HTTP ${response.status}.`);
}

interface Link {
  peer: GatewayConnection;
  socket?: WebSocket;
  retry?: NodeJS.Timeout;
  monitor?: Promise<void>;
  snapshot: MonitorServer[];
  settings: PublicServer[];
  error?: string;
}

export class Gateways {
  private links = new Map<string, Link>();
  constructor(private db: Database, private publish: (event: ServerEvent) => void) {
    for (const peer of db.listGateways()) this.connect(peer);
  }

  private connect(peer: GatewayConnection) {
    const link: Link = { peer, snapshot: [], settings: [] };
    this.links.set(peer.id, link);
    this.openSocket(link);
  }

  private openSocket(link: Link) {
    const address = new URL('/ws?local=1', link.peer.url);
    address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(address, {
      headers: { Authorization: `Bearer ${link.peer.token}` },
      handshakeTimeout: 5_000, maxPayload: 16 * 1024 * 1024,
    });
    link.socket = socket;
    socket.on('open', () => {
      for (const server of link.snapshot) this.publish({ type: 'changed', serverId: qualified(link.peer, server.id) });
    });
    socket.on('message', (data) => {
      if (this.links.get(link.peer.id) !== link) return;
      try {
        const event = JSON.parse(data.toString()) as ServerEvent;
        if (typeof event.serverId === 'string' && identifier.test(event.serverId) &&
          ['changed', 'disconnected', 'item', 'delta'].includes(event.type)) {
          this.publish({ ...event, serverId: qualified(link.peer, event.serverId) });
        }
      } catch { /* Invalid frames never affect local sessions. */ }
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      if (this.links.get(link.peer.id) !== link) return;
      for (const server of link.snapshot) this.publish({ type: 'disconnected', serverId: qualified(link.peer, server.id) });
      link.retry = setTimeout(() => this.openSocket(link), 3_000);
      link.retry.unref();
    });
  }

  private disconnect(id: string) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    clearTimeout(link.retry);
    link.socket?.terminate();
  }

  close() { for (const id of this.links.keys()) this.disconnect(id); }

  async monitor() {
    const links = [...this.links.values()];
    await Promise.all(links.map((link) => {
      link.monitor ??= peerJson<{ servers: MonitorServer[] }>(link.peer, '/api/monitor?local=1')
        .then(({ servers }) => {
          if (!Array.isArray(servers)) throw new Error('Invalid Gate monitor response.');
          link.snapshot = servers.filter((server) => typeof server?.id === 'string' && identifier.test(server.id) && Array.isArray(server.sessions));
          link.error = undefined;
        }).catch((error: Error) => { link.error = error.message; })
        .finally(() => { link.monitor = undefined; });
      return link.monitor;
    }));
    const current = links.filter((link) => this.links.get(link.peer.id) === link);
    const gateways: GatewayStatus[] = current.map(({ peer, error }) => ({ ...publicGateway(peer), error }));
    const servers: MonitorServer[] = current.flatMap(({ snapshot, peer, error }) => snapshot.map((server) => ({
      ...server, id: qualified(peer, server.id), gatewayId: peer.id, gatewayName: peer.name,
      ...(error ? { state: 'error' as const, error: undefined } : {}),
    })));
    return { servers, gateways };
  }

  async servers() {
    const links = [...this.links.values()];
    await Promise.all(links.map(async (link) => {
      try {
        const servers = await peerJson<PublicServer[]>(link.peer, '/api/servers?local=1');
        if (Array.isArray(servers)) link.settings = servers.filter((server) => typeof server?.id === 'string' && identifier.test(server.id));
      } catch { /* Preserve settings while the peer is unavailable. */ }
    }));
    return links.filter((link) => this.links.get(link.peer.id) === link).flatMap(({ settings, peer }) =>
      settings.map((server) => ({ ...server, id: qualified(peer, server.id), gatewayId: peer.id,
        sshAccountId: server.sshAccountId ? qualified(peer, server.sshAccountId) : undefined })));
  }

  private async save(body: Record<string, unknown>, id?: string) {
    const current = id ? this.links.get(id)?.peer : undefined;
    if (id && !current) throw new Error('Gate connection not found.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) throw new Error('Enter a name of up to 80 characters.');
    const url = gatewayUrl(body.url);
    const token = body.token === '' || body.token === undefined ? current?.token : body.token;
    if (!validToken(token)) throw new Error('Enter the remote Gate access token.');
    const remote = await peerJson<{ protocol: number; instanceId: string }>({ url, token }, '/api/gate');
    if (remote?.protocol !== protocol || typeof remote.instanceId !== 'string' || !identifier.test(remote.instanceId)) {
      throw new Error('The remote service must support Gate connections.');
    }
    if (remote.instanceId === this.db.instanceId) throw new Error('This Gate already appears in the panel.');
    if (current && remote.instanceId !== current.instanceId) throw new Error('This address belongs to a different Gate. Add a new connection.');
    if (id && this.links.get(id)?.peer !== current) throw new Error('Gate connection changed. Try again.');
    if ([...this.links.values()].some(({ peer }) => peer.id !== id && (peer.url === url || peer.instanceId === remote.instanceId))) {
      throw new Error('This Gate is already connected.');
    }
    const peer = { id: id ?? randomUUID(), name, url, instanceId: remote.instanceId, token };
    this.db.saveGateway(peer);
    this.disconnect(peer.id);
    this.connect(peer);
    return publicGateway(peer);
  }

  private forward(family: 'servers' | 'ssh/accounts'): RequestHandler {
    return async (req, res, next) => {
      const id = String(req.params.id);
      const delimiter = id.indexOf('~');
      if (delimiter < 0) { next(); return; }
      const link = this.links.get(id.slice(0, delimiter));
      const localId = id.slice(delimiter + 1);
      if (!link || !identifier.test(localId)) { res.status(404).json({ error: 'Gate connection not found.' }); return; }
      const prefix = `/api/${family}/${localId}`;
      const target = new URL(link.peer.url + prefix + req.url);
      if (target.pathname !== prefix && !target.pathname.startsWith(prefix + '/')) {
        res.status(400).json({ error: 'Invalid remote request.' }); return;
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const timeout = setTimeout(cancel, 90_000);
      res.once('close', cancel);
      try {
        const upstream = await fetch(target, {
          method: req.method, redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${link.peer.token}`, 'Content-Type': 'application/json' },
          body: ['GET', 'HEAD'].includes(req.method) || req.body === undefined ? undefined : JSON.stringify(req.body),
        });
        if (upstream.status === 401 || upstream.status === 403) {
          await upstream.body?.cancel();
          res.status(502).json({ error: `${link.peer.name} rejected its access token.` }); return;
        }
        // Keep proxy credentials and cookies out of the browser. File navigations remain inert on this origin.
        for (const header of ['content-type', 'content-disposition']) {
          const value = upstream.headers.get(header);
          if (value) res.set(header, value);
        }
        res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
        res.status(upstream.status);
        if (!upstream.body) res.end();
        else await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res);
      } catch {
        if (res.headersSent) res.destroy();
        else if (!res.destroyed) res.status(502).json({ error: `Could not reach ${link.peer.name}. Check the session before retrying.` });
      } finally { clearTimeout(timeout); res.off('close', cancel); }
    };
  }

  router() {
    const router = Router();
    router.get('/gate', (_req, res) => res.json({ protocol, instanceId: this.db.instanceId }));
    router.get('/gateways', (_req, res) => res.json([...this.links.values()].map(({ peer }) => publicGateway(peer))));
    router.post('/gateways', async (req, res) => res.status(201).json(await this.save(req.body ?? {})));
    router.put('/gateways/:id', async (req, res) => res.json(await this.save(req.body ?? {}, req.params.id)));
    router.delete('/gateways/:id', (req, res) => {
      this.db.deleteGateway(req.params.id);
      this.disconnect(req.params.id);
      res.sendStatus(204);
    });
    router.use('/servers/:id', this.forward('servers'));
    router.use('/ssh/accounts/:id', this.forward('ssh/accounts'));
    return router;
  }
}
