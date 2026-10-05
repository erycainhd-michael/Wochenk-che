// Erzeugt die App-Icons als PNG (ohne externe Abhängigkeiten): node scripts/make-icons.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [20, 83, 45];
const PLATE = [244, 246, 243];
const LEAF = [63, 185, 122];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Teller (Ring) mit Blatt in der Mitte; scale < 1 lässt Rand für "maskable"
function icon(scale) {
  return (x, y, size) => {
    const cx = size / 2, cy = size / 2, u = (size / 2) * scale;
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / u;
    let col = BG;
    const edge = 1.5 / u;
    // Teller
    if (r < 0.78) col = mix(BG, PLATE, Math.min(1, (0.78 - r) / edge));
    if (r < 0.62) col = mix(PLATE, [226, 232, 228], Math.min(1, (0.62 - r) / edge));
    // Blatt: Schnittmenge zweier Kreise, um 45° gedreht
    const a = Math.PI / 4;
    const rx = (dx * Math.cos(a) + dy * Math.sin(a)) / u;
    const ry = (-dx * Math.sin(a) + dy * Math.cos(a)) / u;
    const d1 = Math.hypot(rx, ry - 0.32), d2 = Math.hypot(rx, ry + 0.32);
    const inLeaf = Math.max(d1, d2);
    if (inLeaf < 0.52) col = mix(col, LEAF, Math.min(1, (0.52 - inLeaf) / edge));
    if (Math.abs(ry) < 0.012 * 3 && Math.abs(rx) < 0.36 && inLeaf < 0.5) col = mix(col, BG, 0.5);
    return [...col, 255];
  };
}

fs.mkdirSync('icons', { recursive: true });
fs.writeFileSync('icons/icon-192.png', png(192, icon(1)));
fs.writeFileSync('icons/icon-512.png', png(512, icon(1)));
fs.writeFileSync('icons/apple-touch-icon.png', png(180, icon(1)));
fs.writeFileSync('icons/icon-maskable-512.png', png(512, icon(0.8)));
console.log('Icons erzeugt.');
