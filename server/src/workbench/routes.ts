import { Router, type ErrorRequestHandler } from 'express';
import type { Database } from '../db.js';
import type { SSHManager } from '../ssh-manager.js';

function text(value: unknown, name: string, optional = false): string {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 100_000 || value.includes('\0')) {
    throw new Error(`Invalid ${name}`);
  }
  return value.trim();
}

function provider(value: unknown): string {
  if (value !== 'claude' && value !== 'codex') throw new Error('Choose Claude or Codex');
  return value;
}

export function createWorkbenchRoutes(db: Database, ssh: SSHManager): Router {
  const router = Router();
  const store = db.workbench;

  async function inspectCheckout(serverId: string, directory: string) {
    const machine = db.getServer(serverId);
    if (!machine) throw new Error('Server not found');
    if (ssh.isConnected(machine.id)) await ssh.ensureConnected(machine.id);
    else await ssh.connect({ ...machine, authType: machine.authType });
    const repo = await ssh.probeGitRepo(machine.id, directory);
    if (!repo) throw new Error('Choose a Git repository on this machine');
    const info = await ssh.fetchGitInfo(machine.id, directory);
    return { repo, info };
  }

  router.get('/', (_req, res) => res.json(store.snapshot()));

  router.post('/projects', async (req, res) => {
    const name = text(req.body.name, 'project name');
    const serverId = text(req.body.serverId, 'server');
    const directory = text(req.body.path, 'repository path');
    const defaultProvider = provider(req.body.defaultProvider ?? 'claude');
    const { repo, info } = await inspectCheckout(serverId, directory);
    // Inspect first so connection and repository failures cannot leave an empty project behind.
    const result = store.createProjectWithCheckout({ name, remoteUrl: repo.remoteUrl,
      defaultBranch: repo.defaultBranch, defaultProvider }, {
      serverId, path: info?.worktree ?? repo.canonicalPath, branch: info?.branch ?? repo.defaultBranch,
    });
    res.status(201).json(result);
  });

  router.patch('/projects/:id', (req, res) => {
    res.json(store.updateProject(String(req.params.id), {
      name: req.body.name === undefined ? undefined : text(req.body.name, 'name'),
      defaultBranch: req.body.defaultBranch === undefined ? undefined : text(req.body.defaultBranch, 'branch', true) || null,
      defaultProvider: req.body.defaultProvider === undefined ? undefined : provider(req.body.defaultProvider),
      archivedAt: req.body.archived === undefined ? undefined : req.body.archived === true ? Date.now() : null,
    }));
  });

  router.post('/projects/:id/checkouts', async (req, res) => {
    const projectId = String(req.params.id);
    if (!store.project(projectId)) throw new Error('Project not found');
    const serverId = text(req.body.serverId, 'server');
    const directory = text(req.body.path, 'checkout path');
    const { repo, info } = await inspectCheckout(serverId, directory);
    res.status(201).json(store.createCheckout({ projectId, serverId,
      path: info?.worktree ?? repo.canonicalPath, branch: info?.branch ?? repo.defaultBranch }));
  });

  router.post('/tasks', (req, res) => {
    const isolation = req.body.isolation ?? 'worktree';
    if (isolation !== 'worktree' && isolation !== 'shared') throw new Error('Invalid checkout isolation');
    const goal = text(req.body.goal, 'goal');
    res.status(201).json(store.createTask({ projectId: text(req.body.projectId, 'project'),
      checkoutId: text(req.body.checkoutId, 'checkout'), title: text(req.body.title ?? goal.split('\n')[0], 'title'),
      goal, acceptance: text(req.body.acceptance, 'acceptance', true), isolation,
      provider: req.body.provider === undefined ? undefined : provider(req.body.provider),
    }));
  });

  router.patch('/tasks/:id', (req, res) => {
    const updates: Parameters<typeof store.updateTask>[1] = {};
    for (const key of ['title', 'goal', 'acceptance'] as const) {
      if (req.body[key] !== undefined) updates[key] = text(req.body[key], key, key === 'acceptance');
    }
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.provider !== undefined) updates.provider = provider(req.body.provider);
    res.json(store.updateTask(String(req.params.id), updates));
  });

  router.get('/runs/:id/events', (req, res) => {
    if (!store.run(String(req.params.id))) return res.status(404).json({ error: 'Run not found' });
    res.json(store.events(String(req.params.id), Number(req.query.after ?? 0), Number(req.query.limit ?? 200)));
  });

  const errors: ErrorRequestHandler = (error: Error, _req, res, _next) => {
    const message = error.message.includes('UNIQUE constraint failed: checkouts')
      ? 'This checkout already belongs to a project' : error.message;
    res.status(message.includes('not found') ? 404 : message.includes('in use') ? 409 : 400).json({ error: message });
  };
  router.use(errors);
  return router;
}
