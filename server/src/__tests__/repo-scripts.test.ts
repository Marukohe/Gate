import { describe, it, expect } from 'vitest';
import { extractUrls, parseRepoScripts } from '../repo-scripts.js';

describe('repo scripts', () => {
  it('parses setup, run, and test scripts from gate.json', () => {
    const scripts = parseRepoScripts(JSON.stringify({
      scripts: {
        setup: 'npm install',
        run: 'npm run dev',
        test: 'npm test',
        ignored: 'echo no',
      },
    }));

    expect(scripts).toEqual({
      setup: 'npm install',
      run: 'npm run dev',
      test: 'npm test',
    });
  });

  it('returns empty scripts for invalid or missing config', () => {
    expect(parseRepoScripts('')).toEqual({});
    expect(parseRepoScripts('{bad json')).toEqual({});
    expect(parseRepoScripts(JSON.stringify({ scripts: { run: 42 } }))).toEqual({});
  });

  it('extracts http URLs from command output', () => {
    expect(extractUrls('Local: http://localhost:5173/\nDocs: https://example.com/path?q=1')).toEqual([
      'http://localhost:5173/',
      'https://example.com/path?q=1',
    ]);
  });
});
