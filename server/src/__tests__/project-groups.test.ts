import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectPathsCommand } from '../codex-connection.js';
import { groupProjects } from '../../../client/src/lib/project-groups.js';
import type { Session } from '../types.js';

it('resolves repository subdirectories and linked worktrees without merging separate clones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-projects-'));
  const repo = join(dir, "repo with ' quotes $(false)");
  const worktree = join(dir, 'linked');
  const other = join(dir, 'other', 'repo');
  const plain = join(dir, 'notes');
  const git = (...args: string[]) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', repo);
    git('-C', repo, '-c', 'user.name=Gate Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
    git('-C', repo, 'worktree', 'add', '-b', 'fixture', worktree);
    mkdirSync(join(repo, 'src')); mkdirSync(plain); mkdirSync(other, { recursive: true }); git('init', other);
    const paths = [repo, join(repo, 'src'), worktree, other, plain, join(dir, 'missing')];
    const output = execFileSync('sh', ['-c', projectPathsCommand(paths)], { encoding: 'utf8' });
    expect(output.split('\0').slice(0, -1)).toEqual([repo, repo, repo, other, plain, paths[5]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('groups by full project path and prioritizes attention, running work, then recent history', () => {
  const session = (id: string, cwd: string, state: Session['state'], updatedAt: number, projectPath?: string): Session =>
    ({ id, cwd, state, updatedAt, projectPath, name: id, preview: '', canInput: true });
  const result = groupProjects([
    session('old', '/repo-a', 'saved', 1), session('new', '/repo-b', 'idle', 100),
    session('running', '/repo-c', 'running', 10), session('waiting', '/worktree', 'waiting', 2, '/repo-a'),
    session('other-clone', '/other/repo-a', 'saved', 5),
  ]);
  expect(result.map((group) => group.path)).toEqual(['/repo-a', '/repo-c', '/repo-b', '/other/repo-a']);
  expect(result[0].sessions.map((session) => session.id)).toEqual(['waiting', 'old']);
  expect(result.map((group) => group.context)).toEqual(['/', undefined, undefined, 'other']);
});
