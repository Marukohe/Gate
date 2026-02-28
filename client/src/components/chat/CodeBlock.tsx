import { Check, Copy } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';

// Shared singleton observer — all CodeBlock instances reuse one MutationObserver
const themeListeners = new Set<() => void>();
let sharedObserver: MutationObserver | null = null;

function subscribeToTheme(cb: () => void) {
  themeListeners.add(cb);
  if (!sharedObserver) {
    sharedObserver = new MutationObserver(() => themeListeners.forEach((fn) => fn()));
    sharedObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }
  return () => {
    themeListeners.delete(cb);
    if (themeListeners.size === 0 && sharedObserver) {
      sharedObserver.disconnect();
      sharedObserver = null;
    }
  };
}

function getIsDark() {
  return document.documentElement.classList.contains('dark');
}

const CODE_FONT = "'Fira Code', monospace";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDark = useSyncExternalStore(subscribeToTheme, getIsDark);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language ?? 'text';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1">
        <span className="text-xs text-muted-foreground">{displayLang}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={displayLang}
          style={isDark ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            fontSize: '0.8125rem',
            lineHeight: 1.45,
            background: 'none',
            fontFamily: CODE_FONT,
          }}
          codeTagProps={{
            style: { background: 'none', fontFamily: CODE_FONT },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
