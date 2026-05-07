import { describe, it, expect } from 'vitest';
import { parseGitProbeOutput } from '../ssh-manager.js';

describe('parseGitProbeOutput', () => {
  it('parses a happy path with all four lines', () => {
    const stdout = [
      '/home/user/proj',                   // toplevel (sanity)
      '/home/user/proj/.git',              // git-common-dir
      'git@github.com:foo/bar.git',        // remote.origin.url
      'refs/remotes/origin/main',          // origin/HEAD symref
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result).toEqual({
      canonicalPath: '/home/user/proj',
      remoteUrl: 'git@github.com:foo/bar.git',
      defaultBranch: 'main',
    });
  });

  it('strips a worktree suffix from git-common-dir to find the main repo', () => {
    // Secondary worktree: --git-common-dir points back to main repo's .git
    const stdout = [
      '/home/user/proj-wt-feat',
      '/home/user/proj/.git',
      '',
      'refs/remotes/origin/main',
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result?.canonicalPath).toBe('/home/user/proj');
    expect(result?.remoteUrl).toBeNull();
    expect(result?.defaultBranch).toBe('main');
  });

  it('returns null when toplevel is missing (non-git directory)', () => {
    expect(parseGitProbeOutput('')).toBeNull();
    expect(parseGitProbeOutput('\n\n\n')).toBeNull();
  });

  it('falls back to current branch line when origin/HEAD is absent', () => {
    const stdout = [
      '/home/user/proj',
      '/home/user/proj/.git',
      '',
      'feature/x',                          // last line is the fallback branch
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result?.defaultBranch).toBe('feature/x');
  });

  it('handles git-common-dir reported as relative ".git"', () => {
    const stdout = [
      '/home/user/proj',
      '.git',
      '',
      'refs/remotes/origin/main',
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    // Falls back to toplevel when common-dir is relative
    expect(result?.canonicalPath).toBe('/home/user/proj');
  });

  it('keeps repo checkout toplevel when git common dir is under .repo', () => {
    const stdout = [
      '/home/hewei/standalone/arkcompiler/ets_runtime',
      '/home/hewei/standalone/.repo/projects/arkcompiler/ets_runtime.git',
      '',
      'refs/remotes/origin/main',
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result?.canonicalPath).toBe('/home/hewei/standalone/arkcompiler/ets_runtime');
  });
});
