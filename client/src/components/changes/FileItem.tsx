import { cn } from '@/lib/utils';
import type { GitFileStatus } from '@/stores/git-store';

const STATUS_COLORS: Record<string, string> = {
  added: 'text-green-600 dark:text-green-400',
  modified: 'text-yellow-600 dark:text-yellow-400',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-blue-600 dark:text-blue-400',
  untracked: 'text-muted-foreground',
};

const STATUS_LETTERS: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?',
};

interface FileItemProps {
  file: GitFileStatus;
  selected?: boolean;
  onClick?: () => void;
}

export function FileItem({ file, selected, onClick }: FileItemProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
        selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
      )}
      onClick={onClick}
      title={file.path}
    >
      <span className={cn('shrink-0 font-mono font-bold', STATUS_COLORS[file.status])}>
        {STATUS_LETTERS[file.status]}
      </span>
      <span className="truncate">
        <span className="font-medium">{fileName}</span>
        {dirPath && <span className="text-muted-foreground ml-1">{dirPath}</span>}
      </span>
    </button>
  );
}
