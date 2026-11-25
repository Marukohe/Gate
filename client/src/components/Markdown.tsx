import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './chat/CodeBlock';
import { ScrollableTable } from './chat/ScrollableTable';
import { messageUrl } from '@/lib/message-url';

// Stable renderers preserve code blocks and table state while surrounding views update.
const components: Components = {
  code({ className, children, ...props }) {
    const language = /language-([^\s]+)/.exec(className ?? '')?.[1];
    const code = String(children).replace(/\n$/, '');
    return language || code.includes('\n') ? <CodeBlock code={code} language={language ?? 'text'} />
      : <code className="break-all rounded bg-muted px-1 py-0.5" {...props}>{children}</code>;
  },
  pre({ children }) { return <>{children}</>; },
  table({ children }) { return <ScrollableTable>{children}</ScrollableTable>; },
  a({ href, children }) { return <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>; },
  img({ src, alt }) { return <img src={src} alt={alt || 'Session image'} loading="lazy" />; },
};

export const Markdown = memo(function Markdown({ text, fileEndpoint, directory }: {
  text: string; fileEndpoint: string; directory?: string;
}) {
  return <div className="markdown-prose" onClick={directory ? (event) => {
    const href = (event.target as Element).closest('a')?.getAttribute('href');
    if (!href?.startsWith('#')) return;
    // Document anchors must not change Gate's session route.
    event.preventDefault();
    let anchor = href.slice(1);
    try { anchor = decodeURIComponent(anchor); } catch { /* Keep literal malformed escapes. */ }
    const heading = [...event.currentTarget.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((node) =>
      node.textContent?.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-') === anchor);
    heading?.scrollIntoView({ block: 'nearest' });
  } : undefined}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}
      urlTransform={(url) => messageUrl(url, fileEndpoint, directory)}>{text}</ReactMarkdown>
  </div>;
});
