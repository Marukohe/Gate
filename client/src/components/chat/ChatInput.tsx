import { useState, type KeyboardEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SendHorizontal } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore } from '@/stores/server-store';
import { getInitials, getAvatarColor } from '@/lib/server-utils';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t px-2 py-3 sm:p-4">
      <div className="flex items-end gap-2">
        {/* Server avatar button — mobile only */}
        {activeServer && (
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white lg:hidden',
              getAvatarColor(activeServer.name),
            )}
          >
            {getInitials(activeServer.name)}
          </button>
        )}
        <Textarea
          placeholder="Send a message to Claude..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="!min-h-10 !py-1.5 max-h-[200px] resize-none"
          rows={1}
        />
        <Button size="icon-lg" onClick={handleSend} disabled={disabled || !value.trim()}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
