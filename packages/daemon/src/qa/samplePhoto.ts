import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

let made: Buffer | null = null;

/**
 * The photo the studio hands a product that asks its made-up person to choose one: a plate on a table, drawn
 * here, 640 by 480, as a PNG. A walk has nobody to hold a camera; a feature that starts from a photo (a meal, a
 * receipt) is still walked, with this in the chooser. What a product reads out of it is the product's business.
 */
export function samplePhoto(): Buffer {
  if (made) return made;
  const [width, height] = [640, 480];
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - width / 2, y - height / 2);
      // A table's wood, a white plate with a rim, and something green and something brown on it.
      const colour = d < 70 ? (x < width / 2 ? [96, 142, 62] : [164, 106, 58]) : d < 150 ? [244, 240, 232] : d < 165 ? [214, 208, 198] : [150 + (y % 23 < 2 ? -14 : 0), 104, 66];
      raw.set(colour, y * row + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  made = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return made;
}
