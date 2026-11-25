import { defaultUrlTransform } from 'react-markdown';
import { createContext } from 'react';

export const SessionFileContext = createContext('');

// Paths belong to the session's server, never the browser or Gate's own filesystem.
export function messageUrl(value: string, endpoint: string, directory?: string) {
  if (!value || value.startsWith('#') || value.startsWith('//')) return defaultUrlTransform(value);
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  let path = value;
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== 'localhost') return '';
      path = url.pathname + url.hash;
    } catch { return ''; }
  } else if (path.startsWith('sandbox:/')) path = path.slice('sandbox:'.length);
  const line = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/.exec(path);
  if (line) path = path.slice(0, line.index);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return defaultUrlTransform(value);
  // Decode once: query encoding must preserve spaces, unicode, and literal percent signs.
  try { path = decodeURIComponent(path); } catch { /* A literal percent is a valid filename. */ }
  if (!endpoint || !path || /[\0\r\n]/.test(path)) return '';
  if (directory && !path.startsWith('/')) path = `${directory.replace(/\/$/, '')}/${path}`;
  return `${endpoint}?${new URLSearchParams({ path })}${line ? `#L${line[1] || line[2]}` : ''}`;
}
