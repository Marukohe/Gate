import { expect, it } from 'vitest';
import { excludedDirectories, visibleSessions } from '../visibility.js';
import type { Session } from '../types.js';

it('normalizes directory rules and respects path component boundaries', () => {
  const directories = excludedDirectories(['/repo/', '/repo/./', '/other/../scratch']);
  expect(directories).toEqual(['/repo', '/scratch']);
  const sessions = ['/repo', '/repo/src', '/repo-old', '/scratch/file', '/elsewhere', ''].map((cwd, i) =>
    ({ id: String(i), cwd, projectPath: '/repo' }) as Session);
  expect(visibleSessions(sessions, { excludedDirectories: directories, archivedSessions: [] }).map((s) => s.cwd))
    .toEqual(['/repo-old', '/elsewhere', '']);
  expect(visibleSessions(sessions, { excludedDirectories: ['/'], archivedSessions: [] }).map((s) => s.cwd)).toEqual(['']);
  for (const invalid of [['relative'], ['~/repo'], ['/repo\n/other'], [null], null, Array(101).fill('/repo')]) {
    expect(() => excludedDirectories(invalid)).toThrow();
  }
});
