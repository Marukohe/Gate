export function ToolTag({ name, title }: { name: string; title?: string }) {
  return <span title={title || name} className="max-w-24 shrink-0 truncate rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{name}</span>;
}
