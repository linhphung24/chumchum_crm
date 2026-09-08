/* Sinh icon PNG 192/512 cho PWA (nền hồng đào brand + vòng trắng) — chạy: node scripts/gen-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apps', 'web', 'public');
const BRAND = [251, 106, 82]; // #FB6A52 — Tailwind palette brand

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // mỗi scanline: 1 byte filter + RGBA
  const r = size * 0.225; // bo góc
  const cx = size / 2;
  const circleR = size * 0.26;

  const inRounded = (x, y) => {
    // trong hình vuông bo góc (toạ độ pixel centre)
    const px = x + 0.5;
    const py = y + 0.5;
    const min = 1;
    const max = size - 2;
    const dx = Math.max(min + r - px, px - (max - r), 0);
    const dy = Math.max(min + r - py, py - (max - r), 0);
    return dx * dx + dy * dy <= r * r;
  };
  const inCircle = (x, y) => {
    const px = x + 0.5 - cx;
    const py = y + 0.5 - cx;
    return px * px + py * py <= circleR * circleR;
  };

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      if (inRounded(x, y)) {
        raw[i] = BRAND[0];
        raw[i + 1] = BRAND[1];
        raw[i + 2] = BRAND[2];
        raw[i + 3] = 255;
        if (inCircle(x, y)) {
          raw[i] = 255;
          raw[i + 1] = 255;
          raw[i + 2] = 255;
        }
      } else {
        raw[i + 3] = 0; // trong suốt ngoài góc
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, makeIcon(size));
  console.log(`✅ ${file}`);
}
