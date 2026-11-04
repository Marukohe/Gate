import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSnapshot } from './snapshot.mjs';

export function freezeCheckout({ source, runId, kind, reviewPath, baseRef }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId) || !['review', 'handoff'].includes(kind)) throw new Error('Invalid snapshot identity');
  const git = (args, input) => execFileSync('git', ['-C', source, ...args], {
    input, encoding: 'utf8', maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Gate', GIT_AUTHOR_EMAIL: 'gate@localhost',
      GIT_COMMITTER_NAME: 'Gate', GIT_COMMITTER_EMAIL: 'gate@localhost' },
  }).trim();
  const ref = `refs/gate/${kind}/${runId}`;
  let commit;
  try { commit = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch {}
  if (!commit) {
    const captured = captureSnapshot(source);
    let base = captured.head;
    if (baseRef) {
      for (const candidate of [baseRef, `origin/${baseRef}`]) {
        try {
          const resolved = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`]);
          base = git(['merge-base', captured.head, resolved]);
          break;
        } catch {}
      }
    }
    const candidate = git(['-c', 'commit.gpgsign=false', 'commit-tree', captured.tree, '-p', captured.head],
      `Gate ${kind} snapshot ${runId}\n\nGate-base: ${base}\n`);
    try { git(['update-ref', ref, candidate, '0'.repeat(captured.head.length)]); }
    catch (error) {
      // A retry may race an acknowledged-lost preparation; never overwrite its already pinned snapshot.
      try { git(['rev-parse', '--verify', `${ref}^{commit}`]); } catch { throw error; }
    }
    commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  }
  const head = git(['rev-parse', `${commit}^`]);
  const tree = git(['rev-parse', `${commit}^{tree}`]);
  const base = /Gate-base: ([a-f0-9]{40,64})/.exec(git(['show', '-s', '--format=%B', commit]))?.[1] ?? head;
  const artifactDirectory = path.join(git(['rev-parse', '--absolute-git-dir']), 'gate-context');
  fs.mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
  const patchPath = path.join(artifactDirectory, `${runId}.patch`);
  const output = fs.openSync(patchPath, 'w', 0o600);
  try {
    execFileSync('git', ['-C', source, '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', base, tree, '--'],
      { stdio: ['ignore', output, 'pipe'] });
  } finally { fs.closeSync(output); }
  const snapshot = { head, tree, dirty: tree !== git(['rev-parse', `${head}^{tree}`]), commit, ref, base, patchPath };
  if (kind === 'review') {
    if (!reviewPath || !path.isAbsolute(reviewPath) || reviewPath === source) throw new Error('Review requires an isolated checkout');
    if (!fs.existsSync(reviewPath)) git(['worktree', 'add', '--quiet', '--detach', reviewPath, commit]);
    const root = execFileSync('git', ['-C', reviewPath, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const actual = captureSnapshot(reviewPath);
    if (root !== reviewPath || actual.head !== commit || actual.tree !== tree) throw new Error('Review checkout does not match the pinned snapshot');
  }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(freezeCheckout(JSON.parse(input))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
