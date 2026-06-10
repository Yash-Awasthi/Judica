/**
 * Generates minimal PNG icons for the Chrome extension from SVG source.
 * Requires no external dependencies — writes raw PNG bytes using Node.js builtins.
 *
 * Usage: node generate-icons.js
 *
 * Outputs: icons/icon-16.png, icons/icon-32.png, icons/icon-48.png, icons/icon-128.png
 *
 * For production icons: replace the SVG source below with your brand asset and
 * run this script. The SVG path data draws a minimal "J" (Judica) glyph on a
 * dark background — replace as needed.
 *
 * If a design tool (Figma, Inkscape) is available, export directly to PNG and
 * place files in the icons/ directory. This script is the headless fallback.
 */

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const __dir = new URL(".", import.meta.url).pathname;
mkdirSync(resolve(__dir, "icons"), { recursive: true });

// ── Minimal PNG writer (no deps) ─────────────────────────────────────────────
// Generates a solid-colored PNG with a cross/glyph drawn with pixel ops.

function crc32(buf) {
  let crc = -1;
  const table = crc32.table ?? buildTable();
  crc32.table = table;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function buildTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function adler32(data) {
  let a = 1, b = 0;
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}

function deflateRaw(input) {
  // Store-only DEFLATE (no compression) — fine for small icons
  const blocks = [];
  const BLOCK = 65535;
  for (let i = 0; i < input.length; i += BLOCK) {
    const slice  = input.slice(i, i + BLOCK);
    const last   = i + BLOCK >= input.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = last;
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    blocks.push(header, slice);
  }
  const raw = Buffer.concat(blocks);
  const zlib = Buffer.alloc(6 + raw.length);
  zlib[0] = 0x78; zlib[1] = 0x01; // zlib header
  raw.copy(zlib, 2);
  const ad = adler32(input) >>> 0; // ensure unsigned 32-bit
  zlib.writeUInt32BE(ad, zlib.length - 4);
  return zlib;
}

function makePNG(size, drawFn) {
  const channels = 4; // RGBA
  const pixels   = new Uint8Array(size * size * channels);

  // Fill background: deep dark (#0f0f11)
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = 0x0f;
    pixels[i * 4 + 1] = 0x0f;
    pixels[i * 4 + 2] = 0x11;
    pixels[i * 4 + 3] = 0xff;
  }

  // Draw icon glyph
  drawFn(pixels, size, channels);

  // Build raw PNG scanlines (filter byte = 0 per row)
  const scanlines = Buffer.alloc(size * (1 + size * channels));
  for (let y = 0; y < size; y++) {
    const offset = y * (1 + size * channels);
    scanlines[offset] = 0; // filter type None
    for (let x = 0; x < size * channels; x++) {
      scanlines[offset + 1 + x] = pixels[y * size * channels + x];
    }
  }

  const IHDR = Buffer.alloc(13);
  IHDR.writeUInt32BE(size, 0);
  IHDR.writeUInt32BE(size, 4);
  IHDR[8] = 8;  // bit depth
  IHDR[9] = 6;  // colour type: RGBA
  IHDR[10] = 0; IHDR[11] = 0; IHDR[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", IHDR),
    chunk("IDAT", deflateRaw(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Glyph: horizontal bar + vertical stroke (minimal "J") ────────────────────

function setPixel(pixels, size, channels, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * channels;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
}

function fillRect(pixels, size, channels, x, y, w, h, r, g, b) {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      setPixel(pixels, size, channels, x + dx, y + dy, r, g, b);
}

// Primary accent: electric indigo #6366f1
const [R, G, B] = [0x63, 0x66, 0xf1];

function drawGlyph(pixels, size, channels) {
  const s  = size;
  const t  = Math.max(1, Math.round(s * 0.12)); // stroke thickness
  const p  = Math.round(s * 0.18);              // padding

  // Top horizontal bar
  fillRect(pixels, s, channels, p, p, s - p * 2, t, R, G, B);
  // Vertical stroke (center)
  const cx = Math.round(s * 0.5) - Math.round(t / 2);
  fillRect(pixels, s, channels, cx, p, t, s - p - t, R, G, B);
  // Bottom horizontal bar
  fillRect(pixels, s, channels, p, s - p - t, s - p * 2, t, R, G, B);
  // Left vertical (bottom left serif — makes it a "J")
  fillRect(pixels, s, channels, p, Math.round(s * 0.55), t, Math.round(s * 0.3), R, G, B);
}

// ── Generate all required sizes ───────────────────────────────────────────────

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const png  = makePNG(size, drawGlyph);
  const path = resolve(__dir, `icons/icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated ${path} (${png.length} bytes)`);
}

console.log("\nIcon generation complete.");
console.log("Run `node build.js` to build the extension.");
