import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const releases = 'https://github.com/Marukohe/Gate/releases';
const packageDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const windows = process.platform === 'win32';

export function installedVersion() {
  return JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
}

function installPrefix() {
  const modulesDir = path.resolve(packageDir, '../..');
  const prefix = path.resolve(modulesDir, windows ? '..' : '../..');
  const globalModules = windows ? 'node_modules' : path.join('lib', 'node_modules');
  const launcher = windows ? path.join(prefix, 'gate.cmd') : path.join(prefix, 'bin', 'gate');
  const cli = path.join(packageDir, 'bin', 'gate.js');

  // Use the running installation's prefix even if npm currently defaults to another one.
  if (packageDir !== path.join(prefix, globalModules, '@marukohe', 'gate') || !existsSync(launcher) ||
    (!windows && realpathSync(launcher) !== cli)) {
    throw new Error('Install Gate globally with npm to use gate update.');
  }
  return prefix;
}

export async function update() {
  const prefix = installPrefix();
  const current = installedVersion();
  const latestAsset = `${releases}/latest/download/gate.tgz`;
  // GitHub points the public download at a versioned URL without a REST API request.
  const response = await fetch(latestAsset, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`GitHub release check returned HTTP ${response.status}.`);
  }
  const asset = new URL(response.headers.get('location') ?? '', latestAsset).href;
  const downloads = `${releases}/download/`;
  const latest = asset.startsWith(downloads) && /^v(\d+\.\d+\.\d+)\/gate\.tgz$/.exec(asset.slice(downloads.length))?.[1];
  if (!latest) throw new Error('GitHub returned an unexpected release URL.');

  const comparison = current.localeCompare(latest, 'en', { numeric: true });
  if (comparison >= 0) {
    console.log(comparison === 0
      ? `Gate ${current} is already up to date.`
      : `Gate ${current} is newer than the latest GitHub release (${latest}).`);
    return;
  }
  console.log(`Updating Gate ${current} to ${latest}…`);
  const args = ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', asset];
  const nodeDir = path.dirname(process.execPath);
  // On Windows, invoke npm's JS entry point directly to avoid passing paths through cmd.exe.
  const command = windows ? process.execPath : 'npm';
  if (windows) args.unshift(path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, PATH: [nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm install exited with ${result.signal ?? result.status}.`);
  if (installedVersion() !== latest) throw new Error(`npm finished but Gate ${latest} was not found at ${prefix}.`);

  console.log(`Updated to Gate ${latest}. Restart Gate if it is running.`);
}
