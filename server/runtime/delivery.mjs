import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline';
import { captureSnapshot } from './snapshot.mjs';

const environment = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GATE_MANAGED: '1' });
const redact = (text) => String(text).replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1');
function git(cwd, args, input) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', input, env: environment(), maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function remote(cwd) {
  if (!git(cwd, ['remote']).split('\n').includes('origin')) return null;
  const urls = git(cwd, ['remote', 'get-url', '--push', '--all', 'origin']).split('\n');
  if (urls.length !== 1 || !urls[0]) throw new Error('Delivery requires a single origin push URL');
  const url = urls[0];
  let display = url;
  try { const parsed = new URL(url); parsed.username = ''; parsed.password = ''; display = parsed.href; } catch {}
  return { name: 'origin', display, fingerprint: createHash('sha256').update(url).digest('hex') };
}

export function inspectDelivery(cwd) {
  return { snapshot: captureSnapshot(cwd), branch: git(cwd, ['branch', '--show-current']), remote: remote(cwd) };
}

function sameCode(a, b) { return a.head === b.head && a.tree === b.tree; }
function nonempty(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 100_000) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}
function githubRepo(display) {
  const normalized = display.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/(?:git@)?/, 'https://');
  const url = new URL(normalized);
  if (url.hostname !== 'github.com' || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error('Pull request creation currently requires a github.com origin');
  }
  return `https://github.com${url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`;
}

export function executeDelivery(cwd, request, emit = () => {}, ghPath = 'gh') {
  if (!['commit', 'push', 'create-pr'].includes(request.action)) throw new Error('Choose commit, push, or create-pr');
  const current = inspectDelivery(cwd);
  if (!request.snapshot || !sameCode(current.snapshot, request.snapshot) || current.branch !== request.branch) {
    throw new Error('Checkout changed; refresh the delivery preview before continuing');
  }
  if (!current.branch) throw new Error('Delivery requires a named branch');
  const artifact = () => ({ commit: git(cwd, ['rev-parse', 'HEAD']), tree: git(cwd, ['rev-parse', 'HEAD^{tree}']) });
  const run = (executable, args, input) => {
    try {
      const output = execFileSync(executable, args, { cwd, input, env: environment(), encoding: 'utf8',
        maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
      if (output) emit({ type: 'delivery-output', stream: 'stdout', text: redact(output) });
      return output.trim();
    } catch (error) {
      // Avoid serializing command arguments or authentication-bearing remote URLs in exception messages.
      const detail = redact(error.stderr ?? '');
      throw new Error(`${path.basename(executable)} exited ${error.status ?? error.code ?? error.signal}${detail ? `: ${detail.trim()}` : ''}`);
    }
  };
  const runGit = (args, input) => run('git', ['-C', cwd, ...args], input);
  if (request.action === 'commit') {
    nonempty(request.message, 'commit message');
    if (!current.snapshot.dirty) throw new Error('No changes to commit');
    runGit(['add', '--all', '--', '.']);
    if (git(cwd, ['write-tree']) !== current.snapshot.tree || git(cwd, ['rev-parse', 'HEAD']) !== current.snapshot.head) {
      throw new Error('Checkout changed while staging; inspect the staging area before retrying');
    }
    runGit(['commit', '-F', '-'], request.message);
    const result = artifact();
    emit({ type: 'delivery-completed', ...result });
    if (result.tree !== current.snapshot.tree) throw new Error('Commit hooks changed the committed tree; inspect the recorded commit');
    return result;
  }
  if (!current.remote || current.remote.fingerprint !== request.remote?.fingerprint || request.remote.name !== 'origin') {
    throw new Error('Origin changed or is missing; refresh the delivery preview');
  }
  if (current.snapshot.dirty) throw new Error('Commit or remove working copy changes before pushing or opening a PR');
  if (request.action === 'push') {
    runGit(['push', '--porcelain', '--no-follow-tags', '--recurse-submodules=no', 'origin',
      `${current.snapshot.head}:refs/heads/${current.branch}`]);
    const result = { ...artifact(), commit: current.snapshot.head, tree: current.snapshot.tree, pushed: true };
    emit({ type: 'delivery-completed', ...result });
    return result;
  }
  nonempty(request.title, 'PR title'); nonempty(request.base, 'PR base');
  if (typeof request.body !== 'string' || request.body.includes('\0') || request.body.length > 100_000) throw new Error('Invalid PR body');
  runGit(['check-ref-format', '--branch', request.base]);
  if (request.base === current.branch) throw new Error('Choose a base branch different from the task branch');
  const repo = githubRepo(current.remote.display);
  const pushUrl = git(cwd, ['remote', 'get-url', '--push', 'origin']);
  const pushed = git(cwd, ['ls-remote', '--heads', pushUrl, `refs/heads/${current.branch}`]).split(/\s+/)[0];
  if (pushed !== current.snapshot.head) throw new Error('Push this branch and commit before creating a PR');
  const existing = JSON.parse(run(ghPath, ['pr', 'list', '--repo', repo, '--head', current.branch, '--base', request.base,
    '--state', 'open', '--json', 'url,headRefOid']));
  if (!Array.isArray(existing)) throw new Error('Unexpected pull request response');
  const found = existing.find((item) => item.headRefOid === current.snapshot.head);
  let url = found?.url;
  if (!url) {
    if (existing.length) throw new Error('An open PR has another head; inspect it before retrying');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-pr-'));
    try {
      const bodyFile = path.join(directory, 'body');
      fs.writeFileSync(bodyFile, request.body, { mode: 0o600 });
      url = run(ghPath, ['pr', 'create', '--draft', '--repo', repo, '--head', current.branch, '--base', request.base,
        '--title', request.title, '--body-file', bodyFile]);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url)) throw new Error('Unexpected PR URL; inspect the remote before retrying');
  const result = { commit: current.snapshot.head, tree: current.snapshot.tree, url, reused: !!found };
  emit({ type: 'delivery-completed', ...result });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.once('line', (line) => {
    input.close(); process.stdin.destroy();
    const emit = (value) => console.log(JSON.stringify(value));
    let inspect = false;
    try {
      const config = JSON.parse(line);
      inspect = config.method === 'inspect';
      if (inspect) emit(inspectDelivery(config.cwd));
      else executeDelivery(config.cwd, config.request, emit, config.ghPath);
    } catch (error) {
      if (inspect) console.error(redact(error.message));
      else emit({ type: 'result', failed: true, message: redact(error.message) });
      process.exitCode = 1;
    }
  });
}
