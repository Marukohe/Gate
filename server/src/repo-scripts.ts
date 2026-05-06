export type RepoScriptName = 'setup' | 'run' | 'test';
export type RepoScripts = Partial<Record<RepoScriptName, string>>;

const SCRIPT_NAMES: RepoScriptName[] = ['setup', 'run', 'test'];
const URL_RE = /https?:\/\/[^\s"'<>]+/g;

export function parseRepoScripts(raw: string): RepoScripts {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== 'object') return {};

    const out: RepoScripts = {};
    for (const name of SCRIPT_NAMES) {
      const value = scripts[name];
      if (typeof value === 'string' && value.trim()) out[name] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function extractUrls(output: string): string[] {
  return Array.from(new Set(output.match(URL_RE) ?? []));
}
