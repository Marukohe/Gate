import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDb, type Database } from '../db.js';
import { createWorkbenchRoutes } from '../workbench/routes.js';
import type { SSHManager } from '../ssh-manager.js';

describe('Workbench API', () => {
  let db: Database;
  let http: Server;
  let url: string;
  let machineId: string;
  const ssh = {
    isConnected: vi.fn(() => true), ensureConnected: vi.fn(async () => {}), connect: vi.fn(async () => {}),
    probeGitRepo: vi.fn(async () => ({ canonicalPath: '/repo', remoteUrl: null, defaultBranch: 'main' })),
    fetchGitInfo: vi.fn(async () => ({ branch: 'main', worktree: '/repo' })),
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createDb(':memory:');
    machineId = db.createServer({ name: 'Test', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' }).id;
    const app = express();
    app.use(express.json());
    app.use('/api/workbench', createWorkbenchRoutes(db, ssh as unknown as SSHManager));
    http = createServer(app);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/workbench`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    db.close();
  });
  async function request(path: string, method = 'GET', data?: unknown) {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  }

  it('creates a project and two independent tasks without disturbing a live SSH connection', async () => {
    const created = await request('/projects', 'POST', { name: 'Project', serverId: machineId, path: '/repo' });
    expect(created.status).toBe(201);
    expect(ssh.connect).not.toHaveBeenCalled();
    expect(ssh.ensureConnected).toHaveBeenCalledWith(machineId);
    const input = { projectId: created.data.project.id, checkoutId: created.data.checkout.id, goal: 'First goal' };
    const first = await request('/tasks', 'POST', input);
    const second = await request('/tasks', 'POST', { ...input, goal: 'Second goal' });
    expect(first.status).toBe(201);
    expect(second.data.isolation).toBe('worktree');
    await request(`/tasks/${first.data.id}`, 'PATCH', { status: 'done', goal: 'First changed' });
    const snapshot = (await request('')).data;
    expect(snapshot.tasks.find((task: { id: string }) => task.id === second.data.id))
      .toMatchObject({ goal: 'Second goal', status: 'backlog' });
    expect(snapshot.runs).toEqual([]);
  });

  it('rolls back a duplicate checkout instead of leaving an empty project', async () => {
    const body = { name: 'Project', serverId: machineId, path: '/repo' };
    expect((await request('/projects', 'POST', body)).status).toBe(201);
    expect((await request('/projects', 'POST', { ...body, name: 'Duplicate' })).data.error)
      .toContain('already belongs');
    expect((await request('')).data.projects).toHaveLength(1);
  });

  it('uses saved project defaults for omitted task options and preserves explicit overrides', async () => {
    const { data } = await request('/projects', 'POST', { name: 'Project', serverId: machineId, path: '/repo' });
    const saved = await request(`/projects/${data.project.id}`, 'PATCH', { defaultProvider: 'codex',
      defaultCheckoutId: data.checkout.id, defaultIsolation: 'shared', scripts: { setup: 'npm ci' } });
    expect(saved.status).toBe(200);
    const task = await request('/tasks', 'POST', { projectId: data.project.id, goal: 'Use defaults' });
    expect(task.data).toMatchObject({ checkoutId: data.checkout.id, provider: 'codex', isolation: 'shared' });
    const explicit = await request('/tasks', 'POST', { projectId: data.project.id, goal: 'Override', provider: 'claude', isolation: 'worktree' });
    expect(explicit.data).toMatchObject({ provider: 'claude', isolation: 'worktree' });
    expect((await request(`/projects/${data.project.id}`, 'PATCH', { defaultCheckoutId: false })).status).toBe(400);
  });

  it('validates input and status values and does not create runs by reading the board', async () => {
    expect((await request('/projects', 'POST', {})).status).toBe(400);
    expect((await request('/tasks', 'POST', { goal: 'Goal', isolation: 'unknown' })).status).toBe(400);
    expect((await request('/tasks/unknown', 'PATCH', { status: 'done' })).status).toBe(404);
    expect((await request('/runs/unknown/events')).status).toBe(404);
    expect((await request('')).data).toMatchObject({ projects: [], tasks: [], runs: [] });
    expect(ssh.connect).not.toHaveBeenCalled();
  });
});
