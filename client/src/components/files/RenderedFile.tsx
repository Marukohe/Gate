import { memo, useMemo } from 'react';
import { Markdown } from '@/components/Markdown';
import { htmlPreview } from '@/lib/html-preview';

export const RenderedFile = memo(function RenderedFile({ text, kind, endpoint, directory }: {
  text: string; kind: 'markdown' | 'html'; endpoint: string; directory: string;
}) {
  const html = useMemo(() => kind === 'html' ? htmlPreview(text, endpoint, directory) : '', [text, kind, endpoint, directory]);
  return kind === 'html' ? <iframe title="HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={html} className="block h-full w-full border-0 bg-white" />
    : <div aria-label="Markdown preview" className="p-4 text-sm"><Markdown text={text} fileEndpoint={endpoint} directory={directory} /></div>;
});
