import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function captureSnapshot(cwd) {
  const gitDirectory = execFileSync('git', ['-C', cwd, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  const temporary = fs.mkdtempSync(path.join(gitDirectory, 'gate-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
  const git = (args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
  try {
    const head = git(['rev-parse', 'HEAD']);
    git(['read-tree', head]);
    // A temporary index captures tracked and non-ignored untracked files without changing the user's staging area.
    git(['add', '--all', '--', '.']);
    const tree = git(['write-tree']);
    return { head, tree, dirty: tree !== git(['rev-parse', `${head}^{tree}`]) };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export function readResult(cwd) {
  const snapshot = captureSnapshot(cwd);
  const status = execFileSync('git', ['-C', cwd, 'status', '--short'], { encoding: 'utf8', maxBuffer: 512 * 1024 });
  let diff;
  let truncated = false;
  try {
    diff = execFileSync('git', ['-C', cwd, '--no-pager', 'diff', '--no-ext-diff', '--no-textconv',
      snapshot.head, snapshot.tree, '--'], { encoding: 'utf8', maxBuffer: 256 * 1024 });
  } catch (error) {
    if (error.code !== 'ENOBUFS') throw error;
    diff = String(error.stdout ?? '').slice(0, 250_000);
    truncated = true;
  }
  return { snapshot, status, diff, truncated, capturedAt: Date.now() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    const input = JSON.parse(data);
    console.log(JSON.stringify(input.method === 'result' ? readResult(input.cwd) : captureSnapshot(input.cwd)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
