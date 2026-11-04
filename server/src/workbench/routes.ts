import { Router, type ErrorRequestHandler } from 'express';
import type { Database } from '../db.js';
import type { SSHManager } from '../ssh-manager.js';
import type { ExecutionService } from './execution.js';

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

export function createWorkbenchRoutes(db: Database, ssh: SSHManager, execution?: ExecutionService): Router {
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

  router.put('/checkouts/:id/hooks', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    if (typeof req.body.enabled !== 'boolean') throw new Error('Choose whether to enable hooks');
    res.json(await execution.configureHooks(String(req.params.id), provider(req.body.provider), req.body.enabled));
  });

  router.patch('/observed-sessions/:id', (req, res) => {
    res.json(store.updateObserved(String(req.params.id), {
      taskId: req.body.taskId === undefined ? undefined : req.body.taskId === null ? null : text(req.body.taskId, 'task'),
      inspected: req.body.inspected === true,
    }));
  });

  router.get('/machines/:id/runtime', (req, res) => {
    if (!db.getServer(String(req.params.id))) return res.status(404).json({ error: 'Server not found' });
    res.json(store.runtimeSettings(String(req.params.id)) ?? null);
  });

  router.put('/machines/:id/runtime', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    const settings = { serverId: String(req.params.id), nodePath: text(req.body.nodePath, 'Node.js path'),
      claudePath: text(req.body.claudePath, 'Claude path'), codexPath: text(req.body.codexPath, 'Codex path'),
      directory: text(req.body.directory, 'runtime directory'),
      ...(req.body.pythonPath ? { pythonPath: text(req.body.pythonPath, 'Python path') } : {}),
      ...(req.body.shellPath ? { shellPath: text(req.body.shellPath, 'shell path') } : {}) };
    await execution.configure(settings);
    res.json(store.runtimeSettings(settings.serverId));
  });

  router.post('/attention/:id/respond', (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    res.json(execution.decide(String(req.params.id), req.body));
  });

  router.post('/tasks/:id/verify', (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    res.status(202).json(execution.verify(String(req.params.id), text(req.body.requestId, 'request ID'),
      text(req.body.command, 'test command')));
  });

  router.get('/tasks/:id/scripts', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    res.json(await execution.scripts(String(req.params.id)));
  });

  router.post('/tasks/:id/scripts', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    if (!['setup', 'run', 'test'].includes(req.body.name)) throw new Error('Choose setup, run, or test');
    text(req.body.command, 'script command');
    res.status(202).json(await execution.script(String(req.params.id), text(req.body.requestId, 'request ID'),
      req.body.name, req.body.command));
  });

  router.post('/tasks/:id/terminal', (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    const target = req.body.provider === 'shell' ? 'shell' : provider(req.body.provider);
    res.status(202).json(execution.terminal(String(req.params.id), text(req.body.requestId, 'request ID'), target));
  });

  router.post('/tasks/:id/collaborate', (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    if (req.body.kind !== 'handoff' && req.body.kind !== 'review') throw new Error('Choose handoff or review');
    res.status(202).json(execution.collaborate(String(req.params.id), text(req.body.requestId, 'request ID'),
      req.body.kind, provider(req.body.provider), text(req.body.instructions, 'instructions', true),
      req.body.sourceRunId === undefined ? undefined : text(req.body.sourceRunId, 'source run')));
  });

  router.get('/tasks/:id/result', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    res.json(await execution.result(String(req.params.id)));
  });

  router.post('/tasks/:id/runs', (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    const task = store.task(String(req.params.id));
    if (!task) throw new Error('Task not found');
    const prompt = text(req.body.prompt ?? `${task.goal}\n\nAcceptance criteria:\n${task.acceptance}`, 'prompt');
    res.status(202).json(execution.run(task.id, text(req.body.requestId, 'request ID'), prompt));
  });

  router.post('/runs/:id/stop', async (req, res) => {
    if (!execution) throw new Error('Managed execution is unavailable');
    await execution.stop(String(req.params.id));
    res.json(store.run(String(req.params.id)));
  });

  router.get('/runs/:id/connection', (req, res) => {
    const state = store.execution(String(req.params.id));
    if (!state) return res.status(404).json({ error: 'Managed run not found' });
    res.json({ connectionError: state.connectionError, lastSeenAt: state.lastSeenAt, stopRequested: state.stopRequested });
  });

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
      defaultIsolation: req.body.defaultIsolation,
      defaultCheckoutId: req.body.defaultCheckoutId,
      scripts: req.body.scripts,
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
    const isolation = req.body.isolation;
    if (isolation !== undefined && isolation !== 'worktree' && isolation !== 'shared') throw new Error('Invalid checkout isolation');
    const goal = text(req.body.goal, 'goal');
    res.status(201).json(store.createTask({ projectId: text(req.body.projectId, 'project'),
      checkoutId: req.body.checkoutId === undefined ? undefined : text(req.body.checkoutId, 'checkout'),
      title: text(req.body.title ?? goal.split('\n')[0], 'title'),
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

  router.get('/runs/:id/log', async (req, res) => {
    const run = store.run(String(req.params.id));
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.type('application/x-ndjson').setHeader('Content-Disposition', `attachment; filename="gate-run-${run.id}.jsonl"`);
    let cursor = 0;
    while (!res.destroyed) {
      const page = store.events(run.id, cursor, 100);
      if (!page.length) break;
      cursor = page.at(-1)!.seq;
      if (!res.write(page.map((event) => JSON.stringify(event)).join('\n') + '\n')) {
        await new Promise<void>((resolve) => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
        });
      }
    }
    res.end();
  });

  const errors: ErrorRequestHandler = (error: Error, _req, res, _next) => {
    const message = error.message.includes('UNIQUE constraint failed: checkouts')
      ? 'This checkout already belongs to a project' : error.message;
    res.status(message.includes('not found') ? 404 : message.includes('in use') || message.startsWith('Conflict:') ? 409 : 400)
      .json({ error: message });
  };
  router.use(errors);
  return router;
}
