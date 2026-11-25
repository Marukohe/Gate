import { posix } from 'node:path';
import type { Response } from 'express';
import type { Client, FileEntryWithStats, SFTPWrapper } from 'ssh2';
import type { DirectoryListing, FilePreview } from './types.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Each operation closes only its own SFTP channel, never the shared SSH/tool connection.
function withSftp<T>(ssh: Client, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let channel: SFTPWrapper | undefined;
    let settled = false;
    const finish = (error?: Error, data?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ssh.off('close', lost); channel?.end();
      if (error) reject(error); else resolve(data!);
    };
    const lost = () => finish(new Error('SSH connection closed'));
    const timer = setTimeout(() => finish(new Error('File access timed out')), 20_000);
    ssh.once('close', lost);
    ssh.sftp((error, sftp) => {
      if (error) return finish(error);
      if (settled) { sftp.end(); return; }
      channel = sftp;
      sftp.on('error', finish);
      sftp.on('close', () => finish(new Error('File connection closed')));
      void operation(sftp).then((data) => finish(undefined, data), finish);
    });
  });
}

export function readRemoteFile(ssh: Client, path: string): Promise<Buffer> {
  return withSftp(ssh, (sftp) => new Promise((resolve, reject) => {
    sftp.stat(path, (error, stat) => {
      if (error) return reject(new Error(`Cannot read file: ${error.message}`));
      if (!stat.isFile()) return reject(new Error('This path is not a regular file'));
      if (stat.size > MAX_FILE_BYTES) return reject(new Error('Files larger than 10 MB cannot be opened in Gate'));
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = sftp.createReadStream(path);
      stream.on('error', reject);
      stream.on('data', (data: Buffer) => {
        size += data.length;
        if (size > MAX_FILE_BYTES) { stream.destroy(); reject(new Error('Files larger than 10 MB cannot be opened in Gate')); }
        else chunks.push(data);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }));
}

const MAX_DIRECTORY_ENTRIES = 1000;
export function listRemoteDirectory(ssh: Client, path: string): Promise<Pick<DirectoryListing, 'entries' | 'truncated'>> {
  return withSftp(ssh, async (sftp) => {
    const handle = await new Promise<Buffer>((resolve, reject) => sftp.opendir(path, (error, handle) => error ? reject(error) : resolve(handle)));
    const files: FileEntryWithStats[] = [];
    try {
      // Read bounded batches through a handle; readdir(path) would collect an unbounded directory in memory.
      while (files.length <= MAX_DIRECTORY_ENTRIES) {
        const batch = await new Promise<FileEntryWithStats[] | null>((resolve, reject) => sftp.readdir(handle, (error, files) => {
          if (error && (error as Error & { code?: number }).code === 1) resolve(null); // SFTP EOF
          else if (error) reject(error); else resolve(files);
        }));
        if (!batch) break;
        for (const file of batch) {
          if (!file.filename || file.filename === '.' || file.filename === '..' || /[\/\0\r\n]/.test(file.filename)) continue;
          files.push(file);
          if (files.length > MAX_DIRECTORY_ENTRIES) break;
        }
      }
    } finally {
      await new Promise<void>((resolve) => sftp.close(handle, () => resolve()));
    }
    const entries: DirectoryListing['entries'] = [];
    for (let i = 0; i < Math.min(files.length, MAX_DIRECTORY_ENTRIES); i += 8) {
      entries.push(...await Promise.all(files.slice(i, Math.min(i + 8, MAX_DIRECTORY_ENTRIES)).map(async ({ filename, attrs }) => {
        const symlink = attrs.isSymbolicLink();
        const stat = symlink ? await new Promise<typeof attrs | undefined>((resolve) =>
          sftp.stat(posix.join(path, filename), (error, stat) => resolve(error ? undefined : stat))) : attrs;
        return { name: filename, kind: stat?.isDirectory() ? 'directory' as const : stat?.isFile() ? 'file' as const : 'other' as const,
          symlink, size: stat?.size ?? 0 };
      })));
    }
    entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { entries, truncated: files.length > MAX_DIRECTORY_ENTRIES };
  });
}

export function sessionFilePath(cwd: string, path: string) {
  if (!path || path.length > 4096 || /[\0\r\n]/.test(path)) throw new Error('Invalid file path');
  if (!cwd?.startsWith('/')) throw new Error('Session working directory is unavailable');
  return posix.resolve(cwd, path);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const imageTypes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};

export function previewSessionFile(path: string, data: Buffer): FilePreview {
  if (imageTypes[posix.extname(path).toLowerCase()]) return { path, size: data.length, kind: 'image' };
  if (data.length <= 1024 * 1024 && !data.includes(0)) {
    try { return { path, size: data.length, kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(data) }; }
    catch { /* Binary files download instead. */ }
  }
  return { path, size: data.length, kind: 'download' };
}

export function sendSessionFile(res: Response, path: string, data: Buffer, download = false) {
  // Even SVG/HTML artifacts must never execute code on Gate's origin.
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
  if (download) return res.attachment(posix.basename(path)).type('application/octet-stream').send(data);
  const mime = imageTypes[posix.extname(path).toLowerCase()];
  if (mime) return res.type(mime).send(data);
  const preview = previewSessionFile(path, data);
  if (preview.kind !== 'text') return res.attachment(posix.basename(path)).type('application/octet-stream').send(data);
  const content = preview.text;
  const lines = content.split('\n').map((line, i) => `<span class="line" id="L${i + 1}"><a href="#L${i + 1}">${i + 1}</a>${escape(line) || ' '}</span>`).join('');
  return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(posix.basename(path))}</title><style>
    :root{color-scheme:light dark}body{margin:0;font:14px/1.6 ui-monospace,monospace}header{padding:12px 16px;border-bottom:1px solid #8885;overflow-wrap:anywhere}pre{margin:0;padding:12px 0}.line{display:block;min-height:1.6em;padding-right:16px}.line:target{background:#eab30840}.line a{display:inline-block;width:4em;padding-right:1em;text-align:right;color:inherit;opacity:.5;text-decoration:none;user-select:none}
    </style></head><body><header>${escape(path)}</header><pre>${lines}</pre></body></html>`);
}
