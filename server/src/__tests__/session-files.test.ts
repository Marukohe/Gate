import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Client } from 'ssh2';
import { readRemoteFile, sessionFilePath } from '../session-files.js';
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
