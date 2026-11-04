import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readScripts } from '../../server/runtime/scripts.mjs';

test('repository script discovery preserves literal commands and reports invalid files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-scripts-'));
  try {
    assert.deepEqual(readScripts(root), { scripts: {}, warning: null });
    const command = 'printf "literal $HOME"\nprintf done';
    fs.writeFileSync(path.join(root, 'gate.json'), JSON.stringify({ scripts: { setup: command, test: ' ' } }));
    assert.deepEqual(readScripts(root).scripts, { setup: { command, source: 'gate.json' } });
    fs.writeFileSync(path.join(root, 'gate.json'), '{broken');
    assert.match(readScripts(root).warning, /Cannot read repository scripts/);
    fs.writeFileSync(path.join(root, 'gate.json'), JSON.stringify({ scripts: { run: false } }));
    assert.match(readScripts(root).warning, /scripts.run/);
    fs.writeFileSync(path.join(root, 'gate.json'), ' '.repeat(100_001));
    assert.match(readScripts(root).warning, /100 KB/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
