import { RotateCcw } from 'lucide-react';

interface CheckpointButtonProps {
  onClick: () => void;
}

export function CheckpointButton({ onClick }: CheckpointButtonProps) {
  return (
    <button
      className="absolute -left-8 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center h-6 w-6 rounded-full bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
      onClick={onClick}
      title="Revert to this point"
    >
      <RotateCcw className="h-3 w-3" />
    </button>
  );
}
