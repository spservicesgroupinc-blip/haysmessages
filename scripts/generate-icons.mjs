// Rasterize the existing logo.svg rectangle geometry directly, without dependencies.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
const destination = new URL('../public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
function png(size, maskable = false, badge = false) {
  const scale = (maskable ? 0.65 : 0.84) * size / 65;
  const left = (size - 65 * scale) / 2;
  const top = (size - 42 * scale) / 2;
  const rectangles = [
    [0, 0, 14, 42, [220, 38, 38]],
    [36, 0, 14, 42, [26, 26, 26]],
    [14, 14, 51, 14, [26, 26, 26]],
  ];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  // Four samples per axis soften the geometry while preserving the brand's shape.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const u = (x + (sx + 0.5) / 4 - left) / scale;
        const v = (y + (sy + 0.5) / 4 - top) / scale;
        let rgb = [255, 255, 255]; let alpha = badge ? 0 : 255;
        for (const [rx, ry, rw, rh, color] of rectangles) {
          if (u >= rx && u < rx + rw && v >= ry && v < ry + rh) {
            rgb = badge ? [255, 255, 255] : color; alpha = 255;
          }
        }
        for (let channel = 0; channel < 3; channel++) sums[channel] += rgb[channel];
        sums[3] += alpha;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let channel = 0; channel < 4; channel++) raw[offset + channel] = Math.round(sums[channel] / 16);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const [name, size, maskable, badge] of [
  ['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['badge-96.png', 96, false, true],
]) {
  await writeFile(new URL(name, destination), png(size, maskable, badge));
  console.log(`${name}: ${size} x ${size}`);
}
