import { memo, useContext } from 'react';
import { Markdown } from '@/components/Markdown';
import { ChatImage } from './ChatImage';
import type { Item } from '../../../../server/src/types';
import { messageUrl, SessionFileContext } from '@/lib/message-url';

export const MessageBubble = memo(function MessageBubble({ item }: { item: Item }) {
  const fileEndpoint = useContext(SessionFileContext);
  if (item.kind === 'tool') return <details data-message-id={item.id} className="my-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
    <summary className="cursor-pointer break-all text-muted-foreground">{item.title}<span className="ml-2">{item.status}</span></summary>
    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all">{item.text || 'No output'}</pre>
  </details>;
  if (item.kind === 'notice') return <p data-message-id={item.id} className="my-3 text-sm text-muted-foreground">{item.text}</p>;
  return <div data-message-id={item.id} className={`my-5 flex ${item.kind === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div className={`min-w-0 max-w-full rounded-xl px-4 py-3 text-sm ${item.kind === 'user' ? 'bg-muted sm:max-w-[85%]' : 'w-full'}`}>
      {item.kind === 'user' ? <>
        {item.text && <p className="whitespace-pre-wrap break-words">{item.text}</p>}
        {!!item.images?.length && <div className={`flex flex-wrap gap-2 ${item.text ? 'mt-3' : ''}`}>
          {item.images.map((src, index) => <ChatImage key={`${index}:${src}`} src={messageUrl(src, fileEndpoint)} index={index} />)}
        </div>}
      </> : <Markdown text={item.text} fileEndpoint={fileEndpoint} />}
    </div>
  </div>;
}, ({ item: before }, { item: after }) => before.id === after.id && before.kind === after.kind &&
  before.text === after.text && before.title === after.title && before.status === after.status &&
  before.images?.length === after.images?.length && (before.images ?? []).every((src, index) => src === after.images?.[index]));
