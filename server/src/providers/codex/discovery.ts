import type { SFTPWrapper, FileEntry } from 'ssh2';
import path from 'node:path';
import type { MonitoredSession } from '../../monitor-types.js';

const preview = (text: unknown) => typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
const json = (line: string) => { try { return JSON.parse(line); } catch { return null; } };

// Rollouts are evidence of activity, not handles to the process that wrote them.
export function summarizeCodexSession(head: string, tail: string, modifiedAt: number): MonitoredSession | null {
  const meta = json(head.split('\n')[0]);
  const payload = meta?.payload;
  if (!['session_meta', 'SessionMeta'].includes(meta?.type) || typeof payload?.id !== 'string' ||
      typeof payload.cwd !== 'string') return null;
  // Child agents are implementation details of the parent session, not separate terminal sessions.
  if (payload.source && typeof payload.source === 'object' && 'subagent' in payload.source) return null;
  let state: MonitoredSession['state'] = 'unknown';
  let activity = 'Session discovered · status unconfirmed';
  let updatedAt = Date.parse(meta.timestamp) || modifiedAt;
  for (const line of tail.split('\n')) {
    const item = json(line);
    const event = item?.payload;
    if (!event) continue;
    const time = Date.parse(item.timestamp);
    if (!Number.isFinite(time)) continue;
    let text = '';
    if (['event_msg', 'EventMsg'].includes(item.type)) {
      if (event.type === 'task_complete') { state = 'completed'; text = preview(event.last_agent_message) || 'Last turn finished'; }
      else if (event.type === 'turn_aborted') { state = 'stopped'; text = 'Turn interrupted'; }
      else if (event.type === 'error') { state = 'failed'; text = preview(event.message) || 'Turn failed'; }
      else if (['task_started', 'user_message'].includes(event.type)) { state = 'running'; text = 'Working on a request'; }
      else if (event.type === 'agent_message') { state = 'running'; text = preview(event.message) || 'Generating a response'; }
    } else if (['response_item', 'ResponseItem'].includes(item.type)) {
      if (['function_call', 'custom_tool_call', 'command_execution'].includes(event.type)) {
        state = 'running'; text = preview(`Using ${preview(event.name) || 'a tool'}`);
      } else if (event.type === 'message' && event.role === 'assistant') {
        state = 'running';
        text = preview(Array.isArray(event.content) ? event.content.map((part: { text?: string }) => part?.text ?? '').join(' ') : '') || 'Generating a response';
      } else if (event.type === 'agent_message') { state = 'running'; text = preview(event.text) || 'Generating a response'; }
      else if (event.type === 'message' && event.role === 'user') { state = 'running'; text = 'Working on a request'; }
    }
    if (text) { activity = text; updatedAt = time; }
  }
  return { id: `codex:${payload.id}`, serverId: '', name: path.posix.basename(payload.cwd) || 'Codex session',
    provider: 'codex', cwd: payload.cwd, source: 'external', observation: 'transcript', state, activity,
    nativeSessionId: payload.id, updatedAt };
}

type CachedFile = { size: number; modifiedAt: number; session: MonitoredSession | null };
export type CodexFileCache = Map<string, CachedFile>;

async function mapFiles<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await read(items[index]); }
  }));
  return results;
}

export async function discoverCodexSessions(sftp: SFTPWrapper, home: string, cache: CodexFileCache): Promise<MonitoredSession[]> {
  const list = (dir: string) => new Promise<FileEntry[]>((resolve, reject) => sftp.readdir(dir, (error, entries) => {
    if (error && (error as Error & { code?: number }).code === 2) resolve([]);
    else if (error) reject(error);
    else resolve(entries);
  }));
  let directories = [path.posix.join(home, 'sessions')];
  // Codex stores rollouts under YYYY/MM/DD, including old files updated by resume.
  for (const pattern of [/^\d{4}$/, /^\d{2}$/, /^\d{2}$/]) {
    directories = (await mapFiles(directories, async (dir) => (await list(dir))
      .filter((entry) => (entry.attrs.mode & 0o170000) === 0o040000 && pattern.test(entry.filename))
      .map((entry) => path.posix.join(dir, entry.filename)))).flat();
  }
  const files = (await mapFiles(directories, async (dir) => (await list(dir))
    .filter((entry) => (entry.attrs.mode & 0o170000) === 0o100000 && /^rollout-.*\.jsonl$/.test(entry.filename))
    .map((entry) => ({ file: path.posix.join(dir, entry.filename), size: entry.attrs.size, modifiedAt: entry.attrs.mtime * 1000 }))))
    .flat().sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 100);
  const retained = new Set(files.map((entry) => entry.file));
  for (const file of cache.keys()) if (!retained.has(file)) cache.delete(file);
  const sessions = await mapFiles(files, async ({ file, size, modifiedAt }) => {
    const previous = cache.get(file);
    if (previous?.size === size && previous.modifiedAt === modifiedAt) return previous.session;
    const read = (start: number, length: number) => new Promise<string>((resolve, reject) => {
      const stream = sftp.createReadStream(file, { start, end: start + length - 1 });
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    if (!size) return null;
    // Never download a whole conversation: tool output and prompts can be hundreds of megabytes.
    let head: string;
    try { head = await read(0, Math.min(size, 256 * 1024)); }
    catch (error) {
      // Archiving a session can race a scan; other sessions still need to appear.
      if ((error as { code?: number }).code === 2) { cache.delete(file); return null; }
      throw error;
    }
    const start = Math.max(0, size - 128 * 1024);
    let tail = start ? await read(start, size - start) : head;
    if (start) tail = tail.slice(tail.indexOf('\n') + 1);
    // A writer may still be appending the final JSON record.
    tail = tail.slice(0, tail.lastIndexOf('\n') + 1);
    const session = summarizeCodexSession(head, tail, modifiedAt);
    cache.set(file, { size, modifiedAt, session });
    return session;
  });
  return sessions.filter((session): session is MonitoredSession => !!session);
}
