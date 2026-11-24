export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const IMAGE_LIMITS = { count: 4, fileBytes: 5 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 };
// Includes base64 expansion and the text prompt. Keep the native RPC below its 32 MB limit.
export const INPUT_BODY_LIMIT = '15mb';

export function imageInputs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > IMAGE_LIMITS.count) throw new Error('Attach up to 4 images.');
  let total = 0;
  for (const url of value) {
    if (typeof url !== 'string') throw new Error('Invalid image attachment.');
    const prefix = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(url);
    if (!prefix) throw new Error('Use PNG, JPEG, WebP or GIF images.');
    const data = url.slice(prefix[0].length);
    const bytes = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (bytes > IMAGE_LIMITS.fileBytes) throw new Error('Each image must be 5 MB or smaller.');
    total += bytes;
    if (total > IMAGE_LIMITS.totalBytes) throw new Error('Attachments must total 10 MB or less.');
    if (!data || data.length % 4 || /[^a-zA-Z0-9+/]/.test(data.replace(/={1,2}$/, ''))) throw new Error('Invalid image data.');
    const header = atob(data.slice(0, 24));
    const matches = prefix[1] === 'image/png' ? header.startsWith('\x89PNG\r\n\x1a\n')
      : prefix[1] === 'image/jpeg' ? header.startsWith('\xff\xd8\xff')
        : prefix[1] === 'image/gif' ? /^GIF8[79]a/.test(header)
          : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP';
    if (!matches) throw new Error('Image contents do not match the file type.');
  }
  return value;
}
