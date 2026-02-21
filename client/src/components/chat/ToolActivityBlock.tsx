import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight, Zap, FileText, Search, Terminal, Pencil, Globe, FolderOpen, Loader2 } from 'lucide-react';
import { cn, stripLineNumbers } from '@/lib/utils';
import type { ToolActivityGroup, MergedToolItem } from './group-tools';

const toolIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Read: FileText,
  Grep: Search,
  Glob: FolderOpen,
  Bash: Terminal,
  bash: Terminal,
  Edit: Pencil,
  Write: Pencil,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Zap,
};

function getToolIcon(name?: string) {
  if (!name) return Terminal;
  return toolIcons[name] ?? Zap;
}

function getToolNames(items: MergedToolItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const name = item.call.toolName;
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function ToolLineItem({ item, defaultOpen }: { item: MergedToolItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const Icon = getToolIcon(item.call.toolName);
  const name = item.call.toolName ?? 'tool';
  const detail = item.call.toolDetail || item.call.content.slice(0, 100);
  const isRunning = item.result === null && item.call.type === 'tool_call';
  const content = item.result?.content ?? item.call.content;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 pl-3 text-left text-xs hover:bg-muted/50 rounded">
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground/80">{name}</span>
        <span className="truncate text-muted-foreground">{detail}</span>
        {isRunning && (
          <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-9 pr-3 pb-1">
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-60 overflow-y-auto">
          {stripLineNumbers(content)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ToolActivityBlockProps {
  group: ToolActivityGroup;
}

export function ToolActivityBlock({ group }: ToolActivityBlockProps) {
  const [open, setOpen] = useState(group.isUserBash);
  const count = group.items.length;
  const toolNames = getToolNames(group.items);
  const summary = toolNames.join(', ');

  return (
    <div className="my-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 py-1.5 px-2 text-left text-xs text-muted-foreground hover:bg-muted/50 rounded">
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          <Zap className="h-3.5 w-3.5 shrink-0" />
          <span>
            {count} tool {count === 1 ? 'call' : 'calls'}
            {summary && <span className="ml-1 text-muted-foreground/70">— {summary}</span>}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-l-2 border-muted ml-[11px] mt-0.5">
          {group.items.map((item, i) => (
            <ToolLineItem key={item.call.id ?? i} item={item} defaultOpen={group.isUserBash} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
