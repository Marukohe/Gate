import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ResumeChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResume: (cliSessionId: string) => void;
  onNewChat: () => void;
  listSessions: () => Promise<string[]>;
  currentCliSessionId?: string | null;
}

export function ResumeChatDialog({ open, onOpenChange, onResume, onNewChat, listSessions, currentCliSessionId }: ResumeChatDialogProps) {
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSessions([]);
    listSessions().then((s) => {
      setSessions(s);
      setLoading(false);
    }).catch(() => {
      setSessions([]);
      setLoading(false);
    });
  }, [open, listSessions]);

  const handleSelect = (sid: string) => {
    onResume(sid);
    onOpenChange(false);
  };

  const handleNewChat = () => {
    onNewChat();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Switch Chat</DialogTitle>
          <DialogDescription>Resume an existing CLI session or start new.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto rounded border p-1.5">
          <button
            type="button"
            className="shrink-0 text-left text-xs px-2 py-1.5 rounded bg-muted hover:bg-accent"
            onClick={handleNewChat}
          >
            + New Chat
          </button>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading sessions...
            </div>
          )}
          {!loading && sessions.length === 0 && (
            <div className="text-xs text-muted-foreground py-2 px-2">
              No remote sessions found.
            </div>
          )}
          {sessions.map((sid) => (
            <button
              key={sid}
              type="button"
              className={`shrink-0 text-left text-xs px-2 py-1.5 rounded font-mono overflow-hidden text-ellipsis whitespace-nowrap ${
                sid === currentCliSessionId
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-accent'
              }`}
              onClick={() => handleSelect(sid)}
              title={sid}
            >
              {sid}
              {sid === currentCliSessionId && ' (current)'}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
