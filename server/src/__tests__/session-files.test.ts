import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Client } from 'ssh2';
import { listRemoteDirectory, previewSessionFile, readRemoteFile, sessionFilePath } from '../session-files.js';
import { messageUrl } from '../../../client/src/lib/message-url.js';

it('routes local markdown URLs to the session while preserving web links and rejecting unsafe schemes', () => {
  const endpoint = '/api/servers/remote/sessions/native/file';
  for (const [url, path, hash] of [
    ['/home/alex/a.ts:12:3', '/home/alex/a.ts', '#L12'],
    ['src/main.ts#L20-L24', 'src/main.ts', '#L20'],
    ['README.md:3', 'README.md', '#L3'],
    ['file:///tmp/chart%20one.png', '/tmp/chart one.png', ''],
    ['sandbox:/mnt/data/图.png', '/mnt/data/图.png', ''],
    ['./image%23one.png', './image#one.png', ''],
  ]) {
    const result = new URL(messageUrl(url, endpoint), 'http://gate');
    expect(result.pathname).toBe(endpoint);
    expect(result.searchParams.get('path')).toBe(path);
    expect(result.hash).toBe(hash);
  }
  for (const url of ['https://example.com/a.png', 'http://localhost:3030', 'mailto:me@example.com', '#L2', '//example.com/a']) {
    expect(messageUrl(url, endpoint)).toBe(url);
  }
  for (const url of ['javascript:alert(1)', 'file://other-host/tmp/a', 'data:text/html,<script>alert(1)</script>']) {
    expect(messageUrl(url, endpoint)).toBe('');
  }
  expect(messageUrl('data:image/png;base64,aGVsbG8=', endpoint)).toBe('data:image/png;base64,aGVsbG8=');
  expect(new URL(messageUrl('../images/chart%20one.png', endpoint, '/repo/docs'), 'http://gate').searchParams.get('path')).toBe('/repo/docs/../images/chart one.png');
  expect(new URL(messageUrl('/tmp/chart.png', endpoint, '/repo/docs'), 'http://gate').searchParams.get('path')).toBe('/tmp/chart.png');
  expect(messageUrl('https://example.com/chart.png', endpoint, '/repo/docs')).toBe('https://example.com/chart.png');
  expect(sessionFilePath('/remote/repo', '../chart.png')).toBe('/remote/chart.png');
  expect(sessionFilePath('/remote/repo', '/tmp/chart.png')).toBe('/tmp/chart.png');
  expect(() => sessionFilePath('/repo', 'bad\0path')).toThrow('Invalid');
});

it('reads binary data over a disposable SFTP channel and rejects large or non-regular files', async () => {
  const sftp = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    stat: vi.fn((_path, callback) => callback(null, { size: 4, isFile: () => true })),
    createReadStream: vi.fn(() => Readable.from([Buffer.from([0, 1, 2, 255])])),
  });
  const ssh = Object.assign(new EventEmitter(), { sftp: (callback: Function) => callback(null, sftp) }) as unknown as Client;
  expect(await readRemoteFile(ssh, '/tmp/a.png')).toEqual(Buffer.from([0, 1, 2, 255]));
  expect(sftp.end).toHaveBeenCalledOnce();
  expect(ssh.listenerCount('close')).toBe(0);
  sftp.stat.mockImplementationOnce((_path, callback) => callback(null, { size: 20_000_000, isFile: () => true }));
  await expect(readRemoteFile(ssh, '/large')).rejects.toThrow('10 MB');
  sftp.stat.mockImplementationOnce((_path, callback) => callback(null, { size: 0, isFile: () => false }));
  await expect(readRemoteFile(ssh, '/dev/zero')).rejects.toThrow('regular file');
  expect(sftp.createReadStream).toHaveBeenCalledOnce();
});

const attrs = (kind: string, size = 12) => ({ size, isFile: () => kind === 'file', isDirectory: () => kind === 'directory', isSymbolicLink: () => kind === 'link' });
const entry = (filename: string, kind: string) => ({ filename, attrs: attrs(kind) });
function directorySftp(batches: ReturnType<typeof entry>[][]) {
  const handle = Buffer.from('directory');
  const sftp = Object.assign(new EventEmitter(), {
    end: vi.fn(), close: vi.fn((_handle, callback) => callback()),
    opendir: vi.fn((_path, callback) => callback(undefined, handle)),
    readdir: vi.fn((_handle, callback) => batches.length ? callback(undefined, batches.shift()) : callback(Object.assign(new Error('EOF'), { code: 1 }))),
    stat: vi.fn((path, callback) => path.endsWith('broken') ? callback(new Error('Missing target')) : callback(undefined, attrs('directory'))),
  });
  const ssh = Object.assign(new EventEmitter(), { end: vi.fn(), sftp: (callback: Function) => callback(undefined, sftp) });
  return { sftp, ssh, handle, client: ssh as unknown as Client };
}

it('lists only one remote directory, resolves link types, and preserves special filenames', async () => {
  const { sftp, ssh, handle, client } = directorySftp([
    [entry('.', 'directory'), entry('..', 'directory'), entry('文档 #1 %.txt ', 'file'), entry('src', 'directory')],
    [entry('linked', 'link'), entry('broken', 'link'), entry('pipe', 'other')],
  ]);
  const result = await listRemoteDirectory(client, '/remote/repo');
  expect(result.truncated).toBe(false);
  expect(result.entries.slice(0, 2).map(item => item.name)).toEqual(['linked', 'src']);
  expect(result.entries).toContainEqual({ name: '文档 #1 %.txt ', kind: 'file', size: 12, symlink: false });
  expect(result.entries.find(item => item.name === 'broken')).toMatchObject({ kind: 'other', symlink: true });
  expect(result.entries.find(item => item.name === 'pipe')?.kind).toBe('other');
  expect(sftp.opendir).toHaveBeenCalledExactlyOnceWith('/remote/repo', expect.any(Function));
  expect(sftp.close).toHaveBeenCalledWith(handle, expect.any(Function));
  expect(sftp.end).toHaveBeenCalledOnce(); expect(ssh.end).not.toHaveBeenCalled();
  expect(ssh.listenerCount('close')).toBe(0);
});

it('bounds large directory listings and cleans up errors and stalled SFTP operations', async () => {
  const { client, sftp } = directorySftp([Array.from({ length: 1100 }, (_, i) => entry(`file-${i}`, 'file'))]);
  const result = await listRemoteDirectory(client, '/large');
  expect(result.entries).toHaveLength(1000); expect(result.truncated).toBe(true);
  expect(sftp.readdir).toHaveBeenCalledOnce(); expect(sftp.end).toHaveBeenCalledOnce();
  sftp.opendir.mockImplementationOnce((_path, callback) => callback(new Error('Permission denied')));
  await expect(listRemoteDirectory(client, '/private')).rejects.toThrow('Permission denied');
  vi.useFakeTimers();
  try {
    const stalled = directorySftp([]);
    stalled.sftp.readdir.mockImplementation(() => {});
    const result = expect(listRemoteDirectory(stalled.client, '/slow')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(20_000); await result;
    expect(stalled.sftp.end).toHaveBeenCalledOnce(); expect(stalled.ssh.end).not.toHaveBeenCalled();
    expect(stalled.ssh.listenerCount('close')).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('classifies file previews as inert UTF-8 text, images, or downloads', () => {
  const text = '<script>window.bad = true</script>';
  expect(previewSessionFile('/repo/index.html', Buffer.from(text))).toMatchObject({ kind: 'text', text });
  expect(previewSessionFile('/repo/image.SVG', Buffer.from('<svg/>'))).toMatchObject({ kind: 'image' });
  for (const data of [Buffer.from([0, 255]), Buffer.from([255]), Buffer.alloc(1024 * 1024 + 1, 65)]) {
    expect(previewSessionFile('/repo/data', data)).toMatchObject({ kind: 'download', size: data.length });
  }
});
