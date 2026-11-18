import { posix } from 'node:path';
import type { Response } from 'express';
import type { Client, SFTPWrapper } from 'ssh2';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

// A separate SFTP channel uses the existing SSH connection; closing it never stops Codex.
export function readRemoteFile(ssh: Client, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let channel: SFTPWrapper | undefined;
    let settled = false;
    const finish = (error?: Error, data?: Buffer) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ssh.off('close', lost); channel?.end();
      if (error) reject(error); else resolve(data!);
    };
    const lost = () => finish(new Error('SSH connection closed'));
    const timer = setTimeout(() => finish(new Error('File read timed out')), 20_000);
    ssh.once('close', lost);
    ssh.sftp((error, sftp) => {
      if (error) return finish(error);
      if (settled) { sftp.end(); return; }
      channel = sftp;
      sftp.on('error', finish);
      sftp.on('close', () => { if (!settled) finish(new Error('File connection closed')); });
      sftp.stat(path, (error, stat) => {
        if (settled) return;
        if (error) return finish(new Error(`Cannot read file: ${error.message}`));
        if (!stat.isFile()) return finish(new Error('This path is not a regular file'));
        if (stat.size > MAX_FILE_BYTES) return finish(new Error('Files larger than 10 MB cannot be opened in Gate'));
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = sftp.createReadStream(path);
        stream.on('error', finish);
        stream.on('data', (data: Buffer) => {
          size += data.length;
          if (size > MAX_FILE_BYTES) { stream.destroy(); finish(new Error('Files larger than 10 MB cannot be opened in Gate')); }
          else chunks.push(data);
        });
        stream.on('end', () => finish(undefined, Buffer.concat(chunks)));
      });
    });
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

export function sendSessionFile(res: Response, path: string, data: Buffer) {
  // Even SVG/HTML artifacts must never execute code on Gate's origin.
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer' });
  const mime = imageTypes[posix.extname(path).toLowerCase()];
  if (mime) return res.type(mime).send(data);
  let content: string | undefined;
  if (data.length <= 1024 * 1024 && !data.includes(0)) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { /* Binary files download instead. */ }
  }
  if (content === undefined) return res.attachment(posix.basename(path)).type('application/octet-stream').send(data);
  const lines = content.split('\n').map((line, i) => `<span class="line" id="L${i + 1}"><a href="#L${i + 1}">${i + 1}</a>${escape(line) || ' '}</span>`).join('');
  return res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(posix.basename(path))}</title><style>
    :root{color-scheme:light dark}body{margin:0;font:14px/1.6 ui-monospace,monospace}header{padding:12px 16px;border-bottom:1px solid #8885;overflow-wrap:anywhere}pre{margin:0;padding:12px 0}.line{display:block;min-height:1.6em;padding-right:16px}.line:target{background:#eab30840}.line a{display:inline-block;width:4em;padding-right:1em;text-align:right;color:inherit;opacity:.5;text-decoration:none;user-select:none}
    </style></head><body><header>${escape(path)}</header><pre>${lines}</pre></body></html>`);
}
