import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DiffFileEntry } from './diff-parser';
import { cn } from '@/lib/utils';

interface DiffFileProps {
  file: DiffFileEntry;
  defaultOpen?: boolean;
}

export function DiffFile({ file, defaultOpen = true }: DiffFileProps) {
  const [open, setOpen] = useState(defaultOpen);
  const adds = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0);
  const removes = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'remove').length, 0);

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-mono hover:bg-muted"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="truncate flex-1 text-left">{file.path}</span>
        <span className="text-green-600 dark:text-green-400">+{adds}</span>
        <span className="text-red-600 dark:text-red-400">-{removes}</span>
      </button>
      {open && (
        <div className="overflow-x-auto text-xs font-mono">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              <div className="bg-blue-500/10 px-3 py-0.5 text-blue-600 dark:text-blue-400">{hunk.header}</div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={cn(
                    'px-3 whitespace-pre',
                    line.type === 'add' && 'bg-green-500/10 text-green-700 dark:text-green-300',
                    line.type === 'remove' && 'bg-red-500/10 text-red-700 dark:text-red-300',
                  )}
                >
                  <span className="inline-block w-4 select-none text-muted-foreground">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  {line.content}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
