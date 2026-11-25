import { IMAGE_LIMITS, IMAGE_TYPES } from '../../../server/src/images';

export interface ImageAttachment { id: string; name: string; url: string; size: number }

export function clipboardImages(data: DataTransfer): File[] {
  // Some browsers expose pasted images as items without populating the files list.
  const images = Array.from(data.items ?? []).filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile()).filter((file): file is File => !!file?.type.startsWith('image/'));
  // These are two representations of the same clipboard, not two sets of attachments.
  return images.length ? images : Array.from(data.files ?? []).filter((file) => file.type.startsWith('image/'));
}

export async function readImages(files: File[], current: ImageAttachment[]): Promise<ImageAttachment[]> {
  if (current.length + files.length > IMAGE_LIMITS.count) throw new Error('Attach up to 4 images.');
  let total = current.reduce((sum, image) => sum + image.size, 0);
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use PNG, JPEG, WebP or GIF images.');
    if (!file.size || file.size > IMAGE_LIMITS.fileBytes) throw new Error('Each image must be 5 MB or smaller.');
    total += file.size;
  }
  if (total > IMAGE_LIMITS.totalBytes) throw new Error('Attachments must total 10 MB or less.');
  return Promise.all(files.map(async (file) => {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Cannot read ${file.name}.`));
      reader.readAsDataURL(file);
    });
    // Decode before adding a preview so corrupt files never look ready to send.
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Cannot open ${file.name} as an image.`));
      image.src = url;
    });
    return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, url, size: file.size };
  }));
}
