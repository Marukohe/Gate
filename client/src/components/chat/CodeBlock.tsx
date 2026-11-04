import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';
import { codeLanguageAliases } from '@/lib/code-languages';
import { useUIStore } from '@/stores/ui-store';

const CODE_FONT = "ui-monospace, monospace";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const isDark = useUIStore((state) => state.darkMode);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback for non-secure contexts (HTTP on non-localhost)
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language ?? 'text';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1">
        <span className="text-xs text-muted-foreground">{displayLang}</span>
        <Button
          aria-label="Copy code"
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
          language={codeLanguageAliases[displayLang] ?? displayLang}
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
