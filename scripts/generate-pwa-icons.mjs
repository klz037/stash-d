import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y, size);
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(x, y, size) {
  const paper = [243, 234, 216];
  const polaroid = [255, 253, 248];
  const accent = [194, 74, 42];
  const inner = [217, 203, 179];
  const nx = x / size;
  const ny = y / size;
  if (nx < 0.18 || nx > 0.82 || ny < 0.14 || ny > 0.86) return paper;
  if (ny < 0.22) return accent;
  if (nx > 0.26 && nx < 0.74 && ny > 0.3 && ny < 0.68) return inner;
  return polaroid;
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/public');
writeFileSync(join(dir, 'pwa-192.png'), png(192, icon));
writeFileSync(join(dir, 'pwa-512.png'), png(512, icon));
writeFileSync(join(dir, 'apple-touch-icon.png'), png(180, icon));
console.log('Wrote PWA icons');
