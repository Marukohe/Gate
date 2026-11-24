import { expect, it } from 'vitest';
import { imageInputs, IMAGE_LIMITS } from '../images.js';

const png = (bytes: number) => {
  const data = Buffer.alloc(bytes); Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(data);
  return 'data:image/png;base64,' + data.toString('base64');
};
it('bounds image count, individual size, and combined decoded bytes', () => {
  const small = png(32);
  expect(imageInputs([small])).toEqual([small]);
  expect(imageInputs(undefined)).toEqual([]);
  expect(() => imageInputs(Array(5).fill(small))).toThrow('up to 4');
  expect(() => imageInputs([png(IMAGE_LIMITS.fileBytes + 1)])).toThrow('5 MB');
  const large = png(IMAGE_LIMITS.fileBytes);
  expect(imageInputs([large, large])).toHaveLength(2);
  expect(() => imageInputs([large, large, small])).toThrow('10 MB');
});
it('rejects external URLs, invalid base64, executable formats, and mismatched image signatures', () => {
  for (const value of [null, {}, ['https://example.com/a.png'], ['data:image/svg+xml;base64,PHN2Zy8+'],
    ['data:image/png;base64,bm90LWFuLWltYWdl'], ['data:image/png;base64,iV=BO==='], [42]]) {
    expect(() => imageInputs(value)).toThrow();
  }
});
