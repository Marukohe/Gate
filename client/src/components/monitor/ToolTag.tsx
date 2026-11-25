const colors: Record<string, string> = {
  codex: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  antigravity: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
};

export function ToolTag({ name, title }: { name: string; title?: string }) {
  const key = name.trim().toLowerCase();
  const color = colors[key === 'agy' ? 'antigravity' : key] ?? 'border-border bg-muted/40 text-muted-foreground';
  return <span title={title || name} className={`max-w-24 shrink-0 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${color}`}>{name}</span>;
}
