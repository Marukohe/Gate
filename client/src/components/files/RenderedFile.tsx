import { memo, useEffect, useState } from 'react';
import { Markdown } from '@/components/Markdown';
import { htmlPreview } from '@/lib/html-preview';

export const RenderedFile = memo(function RenderedFile({ text, kind, endpoint, directory }: {
  text: string; kind: 'markdown' | 'html'; endpoint: string; directory: string;
}) {
  const [preview, setPreview] = useState<{ text: string; endpoint: string; directory: string; html: string } | null>(null);
  useEffect(() => {
    if (kind !== 'html') return;
    const controller = new AbortController();
    void htmlPreview(text, endpoint, directory, controller.signal).then((html) => {
      if (!controller.signal.aborted) setPreview({ text, endpoint, directory, html });
    });
    return () => controller.abort();
  }, [text, kind, endpoint, directory]);
  const html = preview?.text === text && preview.endpoint === endpoint && preview.directory === directory ? preview.html : '';
  return kind === 'html' ? (html ? <iframe title="HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={html} className="block h-full w-full border-0 bg-white" />
    : <p role="status" className="p-4 text-sm text-muted-foreground">Loading preview…</p>)
    : <div aria-label="Markdown preview" className="p-4 text-sm"><Markdown text={text} fileEndpoint={endpoint} directory={directory} /></div>;
});
