import { memo, useContext } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { ScrollableTable } from './ScrollableTable';
import type { Item } from '../../../../server/src/types';
import { messageUrl, SessionFileContext } from '@/lib/message-url';

// Stable renderer identities preserve code blocks and table state across message updates.
const markdownComponents: Components = {
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

export const MessageBubble = memo(function MessageBubble({ item }: { item: Item }) {
  const fileEndpoint = useContext(SessionFileContext);
  if (item.kind === 'tool') return <details data-message-id={item.id} className="my-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
    <summary className="cursor-pointer break-all text-muted-foreground">{item.title}<span className="ml-2">{item.status}</span></summary>
    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all">{item.text || 'No output'}</pre>
  </details>;
  if (item.kind === 'notice') return <p data-message-id={item.id} className="my-3 text-sm text-muted-foreground">{item.text}</p>;
  return <div data-message-id={item.id} className={`my-5 flex ${item.kind === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div className={`min-w-0 max-w-full rounded-xl px-4 py-3 text-sm ${item.kind === 'user' ? 'bg-muted sm:max-w-[85%]' : 'w-full'}`}>
      {item.kind === 'user' ? <p className="whitespace-pre-wrap break-words">{item.text}</p> : <div className="markdown-prose">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}
          urlTransform={(url) => messageUrl(url, fileEndpoint)}>{item.text}</ReactMarkdown>
      </div>}
    </div>
  </div>;
}, ({ item: before }, { item: after }) => before.id === after.id && before.kind === after.kind &&
  before.text === after.text && before.title === after.title && before.status === after.status);
