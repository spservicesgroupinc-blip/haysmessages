import type { PreparedPicture } from './types';

export const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

export function pictureDataUrl(picture: { mimeType: string; base64: string; size: number }) {
  if (!PICTURE_TYPES.includes(picture.mimeType) || picture.size < 1 || picture.size > MAX_PICTURE_BYTES ||
    typeof picture.base64 !== 'string' || picture.base64.length > Math.ceil(MAX_PICTURE_BYTES / 3) * 4 ||
    picture.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(picture.base64)) throw new Error('The picture response is invalid.');
  return `data:${picture.mimeType};base64,${picture.base64}`;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this picture. Choose it again.'));
    reader.readAsDataURL(blob);
  });
}

// Resize phone photos before crossing the Apps Script JSON/Sheets boundary.
// Canvas encoding also strips EXIF location data from nonanimated pictures.
export async function preparePicture(file: File): Promise<PreparedPicture> {
  if (!PICTURE_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG, WebP, or GIF picture.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Choose a picture smaller than 15 MB.');
  let blob: Blob = file;
  if (file.type !== 'image/gif') {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('Picture dimensions are too large.');
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Picture processing is unavailable.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare the picture.')), type, 0.85));
    } catch (error) {
      throw new Error(error instanceof Error && error.message === 'Picture dimensions are too large.' ? error.message : 'Could not open this picture. Try another JPG or PNG.');
    } finally { URL.revokeObjectURL(url); }
  }
  if (blob.size > MAX_PICTURE_BYTES) throw new Error('The prepared picture exceeds 2 MB. Choose a smaller picture.');
  const preview = await readDataUrl(blob);
  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
  const name = `${file.name.replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 140) || 'picture'}.${extension}`;
  return { name, mimeType: blob.type, size: blob.size, base64: preview.split(',')[1], preview };
}
