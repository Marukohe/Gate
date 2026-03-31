import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { SendHorizontal, Paperclip, Loader2, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { getInitials, getAvatarColor } from '@/lib/server-utils';
import { cn } from '@/lib/utils';

interface UploadedFile {
  name: string;
  remotePath: string;
}

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const activeSession = useSessionStore((s) => {
    if (!activeServerId) return undefined;
    const list = s.sessions[activeServerId];
    return list?.find((sess) => sess.id === activeSessionId);
  });

  // Only Claude supports file uploads
  const canUpload = (activeSession?.provider ?? 'claude') === 'claude';

  // Track IME composition state via events (more reliable than isComposing)
  const composingRef = useRef(false);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed && files.length === 0) return;

    // Prepend file references to the message
    const fileRefs = files.map((f) => `@${f.remotePath}`).join(' ');
    const message = fileRefs
      ? `${fileRefs}${trimmed ? ' ' + trimmed : ''}`
      : trimmed;

    onSend(message);
    setValue('');
    setFiles([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeServerId || !activeSessionId) return;
    // Reset input so same file can be selected again
    e.target.value = '';

    setUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const res = await fetch(`/api/servers/${activeServerId}/sessions/${activeSessionId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, data: base64 }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      const { remotePath } = await res.json();
      setFiles((prev) => [...prev, { name: file.name, remotePath }]);
    } catch (err: any) {
      console.error('Upload failed:', err.message);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // iOS PWA: keyboard dismiss can leave viewport offset, reset scroll position
  const handleBlur = useCallback(() => {
    setTimeout(() => window.scrollTo(0, 0), 100);
  }, []);

  return (
    <div>
      {/* File chips — above the border so they don't shift the divider line */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-1.5 sm:px-4">
          {files.map((f, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400"
              title={f.remotePath}
            >
              @{f.name}
              <button
                onClick={() => removeFile(i)}
                className="rounded-full p-0.5 hover:bg-blue-500/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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
          placeholder="Send a message..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { setTimeout(() => { composingRef.current = false; }, 0); }}
          disabled={disabled}
          className="!min-h-10 !py-1.5 max-h-[200px] resize-none"
          rows={1}
        />
          {canUpload && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Button
                variant="ghost"
                size="icon-lg"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || uploading}
                title="Upload file"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
            </>
          )}
          <Button size="icon-lg" onClick={handleSend} disabled={disabled || (!value.trim() && files.length === 0)}>
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
