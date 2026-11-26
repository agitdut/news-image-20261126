// news-image-20261126 — "The World in One Day"
// A one-page newspaper front page summing up Thursday 26 November 2026:
// 1 lead story + 6 featured stories + 24 briefs = 31 stories across 5 continents.
// Drawn from scratch: framebuffer + 5x7 bitmap font + palette PNG encoder
// (LZ77 + fixed-Huffman DEFLATE written by hand, stdlib only, no network).
// Deterministic: no clock, no randomness — two runs write identical bytes.

import * as fs from "node:fs";
import * as path from "node:path";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
// 0 paper, 1 ink, 2 red, 3 blue, 4 orange, 5 gold, 6 teal, 7 grey,
// 8 tint, 9 darkred, 10 white, 11 green, 12 flame yellow, 13 navy, 14 sky
const PALETTE: Array<[number, number, number]> = [
  [246, 241, 227], // 0 paper
  [27, 23, 18], // 1 ink
  [163, 31, 22], // 2 red
  [29, 78, 137], // 3 blue
  [217, 108, 30], // 4 orange
  [224, 165, 31], // 5 gold
  [31, 110, 94], // 6 teal
  [216, 210, 192], // 7 grey
  [239, 233, 216], // 8 tint
  [122, 21, 14], // 9 darkred
  [255, 255, 255], // 10 white
  [46, 107, 52], // 11 green
  [242, 194, 48], // 12 flame yellow
  [18, 54, 92], // 13 navy
  [191, 211, 230], // 14 sky
];
const PAPER = 0;
const INK = 1;
const RED = 2;
const BLUE = 3;
const ORANGE = 4;
const GOLD = 5;
const TEAL = 6;
const GREY = 7;
const TINT = 8;
const DARKRED = 9;
const WHITE = 10;
const GREEN = 11;
const FLAMEY = 12;
const NAVY = 13;
const SKY = 14;

// ---------------------------------------------------------------- framebuffer
const fb = new Uint8Array(W * H);
fb.fill(PAPER);

function px(x: number, y: number, c: number): void {
  if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = c;
}
function rect(x: number, y: number, w: number, h: number, c: number): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, c);
}
function hline(x: number, y: number, w: number, c: number): void {
  rect(x, y, w, 1, c);
}
function vline(x: number, y: number, h: number, c: number): void {
  rect(x, y, 1, h, c);
}
function frame(x: number, y: number, w: number, h: number, c: number, t: number): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}
function circle(cx: number, cy: number, r: number, c: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    hline(cx - dx, cy + dy, dx * 2 + 1, c);
  }
}
function line(x0: number, y0: number, x1: number, y1: number, c: number): void {
  // Round up front: callers may pass scaled (fractional) coordinates, and
  // Bresenham only terminates when its integer steps can reach the target.
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
function fillTriangle(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number,
): void {
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: Array<[number, number, number, number]> = [
      [x0, y0, x1, y1],
      [x1, y1, x2, y2],
      [x2, y2, x0, y0],
    ];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(Math.round(ax + ((y - ay) * (bx - ax)) / (by - ay)));
      }
    }
    if (xs.length >= 2) {
      const a = Math.min(...xs);
      const b = Math.max(...xs);
      hline(a, y, b - a + 1, c);
    }
  }
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows, each a 5-bit value (bit 4 = leftmost pixel).
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "%": [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  '"': [0x0a, 0x0a, 0, 0, 0, 0, 0],
  "*": [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale;
}
function drawText(text: string, x: number, y: number, scale: number, c: number): void {
  for (let ci = 0; ci < text.length; ci++) {
    const g = FONT[text[ci]] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          rect(x + ci * 6 * scale + col * scale, y + row * scale, scale, scale, c);
        }
      }
    }
  }
}
function drawCentered(text: string, cx: number, y: number, scale: number, c: number): void {
  drawText(text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}
function wrapText(text: string, maxW: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}
function drawBlock(
  text: string, x: number, y: number, maxW: number, scale: number, c: number, lh: number,
): number {
  const lines = wrapText(text, maxW, scale);
  lines.forEach((ln, i) => drawText(ln, x, y + i * lh, scale, c));
  return lines.length;
}

// ---------------------------------------------------------------- PNG encoder
// CRC-32 (IEEE) and Adler-32, then DEFLATE with fixed Huffman codes + LZ77.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99,
  115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025,
  1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12,
  12, 13, 13,
];

class BitWriter {
  out: number[] = [];
  acc = 0;
  nbits = 0;
  bit(b: number): void {
    this.acc |= (b & 1) << this.nbits;
    this.nbits++;
    if (this.nbits === 8) {
      this.out.push(this.acc & 0xff);
      this.acc = 0;
      this.nbits = 0;
    }
  }
  // Write a Huffman code MSB-first into the LSB-first stream.
  code(code: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bit((code >> i) & 1);
  }
  bits(value: number, len: number): void {
    for (let i = 0; i < len; i++) this.bit((value >> i) & 1);
  }
  flush(): void {
    if (this.nbits > 0) {
      this.out.push(this.acc & 0xff);
      this.acc = 0;
      this.nbits = 0;
    }
  }
}

function litLenCode(sym: number): [number, number] {
  if (sym < 144) return [0x30 + sym, 8];
  if (sym < 256) return [0x190 + (sym - 144), 9];
  if (sym < 280) return [sym - 256, 7];
  return [0xc0 + (sym - 280), 8];
}

function deflateFixed(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.bit(1); // BFINAL
  w.bit(1); // BTYPE bit 0 (fixed Huffman = 01, LSB first)
  w.bit(0); // BTYPE bit 1
  // LZ77 with a single-candidate hash table (3-byte hash).
  const head = new Int32Array(32768);
  head.fill(-1);
  const n = data.length;
  let pos = 0;
  while (pos < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (pos + 2 < n) {
      const h = (((data[pos] << 16) ^ (data[pos + 1] << 8) ^ data[pos + 2]) & 0x7fff) >>> 0;
      const cand = head[h];
      head[h] = pos;
      if (cand >= 0 && pos - cand <= 32768) {
        let len = 0;
        while (
          len < 258 &&
          pos + len < n &&
          data[cand + len] === data[pos + len]
        ) {
          len++;
        }
        if (len >= 3) {
          bestLen = len;
          bestDist = pos - cand;
        }
      }
    }
    if (bestLen >= 3) {
      // Length symbol.
      let li = 0;
      while (li < LEN_BASE.length - 1 && LEN_BASE[li + 1] <= bestLen) li++;
      if (bestLen === 258) li = 28;
      const [lc, ll] = litLenCode(257 + li);
      w.code(lc, ll);
      if (LEN_EXTRA[li] > 0) w.bits(bestLen - LEN_BASE[li], LEN_EXTRA[li]);
      // Distance symbol (5-bit fixed code).
      let di = 0;
      while (di < DIST_BASE.length - 1 && DIST_BASE[di + 1] <= bestDist) di++;
      w.code(di, 5);
      if (DIST_EXTRA[di] > 0) w.bits(bestDist - DIST_BASE[di], DIST_EXTRA[di]);
      pos += bestLen;
    } else {
      const [lc, ll] = litLenCode(data[pos]);
      w.code(lc, ll);
      pos++;
    }
  }
  const [ec, el] = litLenCode(256); // end of block
  w.code(ec, el);
  w.flush();
  return new Uint8Array(w.out);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcIn = new Uint8Array(4 + data.length);
  crcIn.set(out.subarray(4, 8), 0);
  crcIn.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcIn));
  return out;
}

function encodePNG(): Uint8Array {
  // Filtered scanlines: row 0 uses Sub, the rest use Up (rows repeat a lot).
  const raw = new Uint8Array(H * (1 + W));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W);
    const prev = y === 0 ? null : fb.subarray((y - 1) * W, y * W);
    const cur = fb.subarray(y * W, (y + 1) * W);
    if (y === 0) {
      raw[rowStart] = 1;
      raw[rowStart + 1] = cur[0];
      for (let x = 1; x < W; x++) raw[rowStart + 1 + x] = (cur[x] - cur[x - 1]) & 0xff;
    } else {
      raw[rowStart] = 2;
      for (let x = 0; x < W; x++) raw[rowStart + 1 + x] = (cur[x] - (prev as Uint8Array)[x]) & 0xff;
    }
  }
  const comp = deflateFixed(raw);
  const zlib = new Uint8Array(comp.length + 6);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib.set(comp, 2);
  const ad = adler32(raw);
  zlib[zlib.length - 4] = (ad >>> 24) & 0xff;
  zlib[zlib.length - 3] = (ad >>> 16) & 0xff;
  zlib[zlib.length - 2] = (ad >>> 8) & 0xff;
  zlib[zlib.length - 1] = ad & 0xff;

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: palette
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = new Uint8Array(PALETTE.length * 3);
  PALETTE.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

// ---------------------------------------------------------------- pictograms
// Each icon draws inside an 80x76 box at (ox, oy), scaled by s.
function iconFlameTanker(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  // Flame: three stacked triangles, wide at the base.
  fillTriangle(X(40), Y(2), X(12), Y(44), X(68), Y(44), ORANGE);
  fillTriangle(X(40), Y(14), X(24), Y(44), X(56), Y(44), FLAMEY);
  fillTriangle(X(40), Y(26), X(32), Y(44), X(48), Y(44), RED);
  // Tanker: capsule tank with a gold band, cab, wheels tucked under.
  rect(X(6), Y(48), 50, 16, INK);
  circle(X(6), Y(56), 8 * s, INK);
  circle(X(56), Y(56), 8 * s, INK);
  rect(X(8), Y(53), 46, 4, GOLD);
  rect(X(60), Y(52), 16, 12, INK);
  rect(X(62), Y(54), 6, 6, SKY);
  rect(X(70), Y(54), 4, 6, SKY);
  circle(X(18), Y(66), 6 * s, INK);
  circle(X(48), Y(66), 6 * s, INK);
  circle(X(68), Y(66), 6 * s, INK);
  circle(X(18), Y(66), 2 * s, PAPER);
  circle(X(48), Y(66), 2 * s, PAPER);
  circle(X(68), Y(66), 2 * s, PAPER);
  hline(X(0), Y(74), 80 * s, GREY);
}
function iconBars(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  const heights = [18, 30, 42, 54];
  const cols = [TEAL, BLUE, GOLD, RED];
  heights.forEach((h, i) => {
    rect(X(10 + i * 18), Y(62 - h), 12, h, cols[i]);
  });
  hline(X(6), Y(62), 72 * s, INK);
  line(X(10), Y(44), X(74), Y(8), INK);
  fillTriangle(X(74), Y(8), X(66), Y(10), X(72), Y(16), INK);
}
function iconScales(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  vline(X(40), Y(8), 52 * s, INK);
  hline(X(12), Y(14), 56 * s, INK);
  circle(X(40), Y(8), 3 * s, INK);
  line(X(14), Y(14), X(14), Y(34), INK);
  line(X(66), Y(14), X(66), Y(34), INK);
  fillTriangle(X(4), Y(34), X(24), Y(34), X(14), Y(48), GOLD);
  fillTriangle(X(56), Y(34), X(76), Y(34), X(66), Y(48), GOLD);
  hline(X(28), Y(60), 24 * s, INK);
  hline(X(32), Y(64), 16 * s, INK);
}
function iconBarrel(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  rect(X(22), Y(10), 36, 44, NAVY);
  rect(X(22), Y(16), 36, 3, SKY);
  rect(X(22), Y(32), 36, 3, SKY);
  rect(X(22), Y(48), 36, 3, SKY);
  drawText("$", X(36), Y(24), 2, WHITE);
  // Waves below.
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 8; i++) {
      const wx = X(6 + i * 9);
      const wy = Y(60 + r * 5);
      line(wx, wy, wx + 4 * s, wy - 2 * s, BLUE);
      line(wx + 4 * s, wy - 2 * s, wx + 8 * s, wy, BLUE);
    }
  }
}
function iconJet(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  // Jet silhouette, nose to the upper right.
  fillTriangle(X(12), Y(48), X(30), Y(34), X(30), Y(52), INK);
  fillTriangle(X(30), Y(34), X(72), Y(22), X(72), Y(30), INK);
  fillTriangle(X(30), Y(52), X(72), Y(56), X(72), Y(48), INK);
  fillTriangle(X(36), Y(38), X(52), Y(14), X(58), Y(38), INK);
  fillTriangle(X(36), Y(48), X(52), Y(66), X(58), Y(48), INK);
  // Prohibition ring + slash.
  const cx = X(40);
  const cy = Y(38);
  const r = Math.round(34 * s);
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    px(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), RED);
    px(Math.round(cx + (r - 3 * s) * Math.cos(rad)), Math.round(cy + (r - 3 * s) * Math.sin(rad)), RED);
  }
  line(X(16), Y(62), X(64), Y(14), RED);
  line(X(16), Y(65), X(64), Y(17), RED);
  line(X(16), Y(62), X(64), Y(14), RED);
}
function iconMissile(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  fillTriangle(X(40), Y(4), X(30), Y(22), X(50), Y(22), INK);
  rect(X(30), Y(22), 20, 34, INK);
  fillTriangle(X(30), Y(44), X(18), Y(62), X(30), Y(56), INK);
  fillTriangle(X(50), Y(44), X(62), Y(62), X(50), Y(56), INK);
  fillTriangle(X(40), Y(60), X(34), Y(72), X(46), Y(72), ORANGE);
  fillTriangle(X(40), Y(64), X(37), Y(72), X(43), Y(72), FLAMEY);
  // Stars.
  drawText("*", X(8), Y(10), 2, GOLD);
  drawText("*", X(62), Y(28), 2, GOLD);
}
function iconRefinery(ox: number, oy: number, s: number): void {
  const X = (v: number) => Math.round(ox + v * s);
  const Y = (v: number) => Math.round(oy + v * s);
  // Two distillation towers.
  rect(X(12), Y(24), 14, 44, INK);
  rect(X(34), Y(14), 14, 54, INK);
  rect(X(56), Y(30), 12, 38, NAVY);
  for (let r = 0; r < 4; r++) hline(X(12), Y(30 + r * 10), 14 * s, PAPER);
  for (let r = 0; r < 5; r++) hline(X(34), Y(22 + r * 10), 14 * s, PAPER);
  // Flame on the tall tower.
  fillTriangle(X(41), Y(2), X(35), Y(14), X(47), Y(14), ORANGE);
  fillTriangle(X(41), Y(6), X(38), Y(14), X(44), Y(14), FLAMEY);
  hline(X(8), Y(68), 64 * s, INK);
}

// ---------------------------------------------------------------- content
interface Story {
  tag: string;
  tagColor: number;
  headline: string;
  body: string;
  icon: (ox: number, oy: number, s: number) => void;
}

const LEAD = {
  tag: "DISASTER - EGYPT",
  headline: "31 KILLED AS FUEL TANKER ERUPTS IN CAIRO",
  body: "A FUEL TANKER OVERTURNED AND BURST INTO FLAMES ON CAIRO'S RING ROAD. AT LEAST 31 PEOPLE WERE KILLED AND 21 INJURED, EGYPT'S HEALTH MINISTRY SAID.",
};

const FEATURED: Story[] = [
  {
    tag: "TRADE - WASHINGTON",
    tagColor: BLUE,
    headline: "TRUMP UNVEILS NEW TARIFFS ON 14 PARTNERS",
    body: "WASHINGTON PROPOSED NEW DUTIES ON 14 ECONOMIES, INCLUDING CHINA, THE EU AND JAPAN, TO FIGHT WHAT IT CALLS EXCESS INDUSTRIAL CAPACITY.",
    icon: iconBars,
  },
  {
    tag: "ISRAEL - COURTS",
    tagColor: NAVY,
    headline: "JUDGES URGE DROP OF NETANYAHU BRIBERY CASE",
    body: "ISRAELI JUDGES TOLD PROSECUTORS TO DROP THE BRIBERY CASE AGAINST PM NETANYAHU, SAYING A CONVICTION WAS UNLIKELY.",
    icon: iconScales,
  },
  {
    tag: "ENERGY - THE GULF",
    tagColor: ORANGE,
    headline: "MINES AND MISSILES JOLT OIL MARKETS",
    body: "IRAN SAID TWO TANKERS HIT NAVAL MINES IN THE STRAIT OF HORMUZ, AS HOUTHIS CLAIMED A STRIKE ON SAUDI ARABIA'S BIGGEST REFINERY. BRENT CRUDE ROSE.",
    icon: iconBarrel,
  },
  {
    tag: "EUROPE - SECURITY",
    tagColor: TEAL,
    headline: "POLAND TO CLOSE SKIES NEAR UKRAINE BORDER",
    body: "WARSAW SAID IT WILL CREATE A NO-FLY ZONE NEAR UKRAINE AFTER REPEATED AIRSPACE INCURSIONS BLAMED ON RUSSIA.",
    icon: iconJet,
  },
  {
    tag: "ASIA - KOREA",
    tagColor: RED,
    headline: "NORTH KOREA EXPELS SWISS DIPLOMAT",
    body: "PYONGYANG ORDERED SWITZERLAND'S TOP DIPLOMAT OUT WITHIN 48 HOURS AS KIM JONG UN CALLED FOR MORE TACTICAL NUCLEAR WEAPONS.",
    icon: iconMissile,
  },
  {
    tag: "UKRAINE - WAR",
    tagColor: DARKRED,
    headline: "UKRAINE HITS RUSSIAN AIRFIELD AND REFINERIES",
    body: "KYIV SAID IT STRUCK A RUSSIAN AIRFIELD AND TWO OIL REFINERIES, AND SHOT DOWN 88 OF 112 DRONES IN AN OVERNIGHT ATTACK.",
    icon: iconRefinery,
  },
];

const BRIEFS: string[] = [
  "COLOMBIA: 76 HOSTAGES FREED AS TROOPS STORM CARTAGENA SUPERMARKET AFTER 17-HOUR SIEGE",
  "NIGERIA: HUGE METH LAB SEIZED IN ENUGU, FIVE MEXICAN SUSPECTS ARRESTED",
  "SPACE: FCC CLEARS SPACEX PLAN FOR UP TO A MILLION ORBITAL DATA CENTRES",
  "THANKSGIVING: MACY'S 100TH PARADE DELAYED TO SATURDAY AS STORM NEARS NEW YORK",
  "INDONESIA: 13 DEAD AND 13 TRAPPED IN ILLEGAL GOLD MINE IN WEST JAVA",
  "SOUTH KOREA: CENTRAL BANK RAISES RATE TO 3.25% AS AI EXPORT BOOM RUNS HOT",
  "MARKETS: NVIDIA SLIDES 3.9% AS S&P PUTS ITS CREDIT RATING ON DOWNGRADE WATCH",
  "TECH: HUAWEI FOUND GUILTY IN US OF BANK FRAUD AND IRAN-LINKED DEALINGS",
  "CHINA: SHENZHOU-24 LAUNCHES WITH PAKISTAN'S FIRST ASTRONAUT ABOARD",
  "BRITAIN: INQUIRY ORDERED INTO NUCLEAR TESTING'S TOLL ON VETERANS",
  "GERMANY: HITLER'S EAGLE'S NEST TO BE REBUILT AFTER FIRE",
  "MISS UNIVERSE: PUERTO RICO'S JENNIFER BARRETO, FIRST MARRIED WINNER",
  "SPORT: STEELERS RELEASE QB AARON RODGERS AFTER COACH ROW",
  "CHESS: WORLD TITLE MATCH LEVEL 1-1 AS GAME 3 OPENS IN GENEVA",
  "INDIA: 18 YEARS SINCE THE 26/11 MUMBAI ATTACKS, NATION REMEMBERS",
  "GAZA: STORM THREATENS 1.76 MILLION PEOPLE IN MAKESHIFT SHELTERS",
  "USA: ARMY DESTROYS 4.5 TONNES OF AGEING EXPLOSIVES IN HUGE IOWA BLAST",
  "CLIMATE: EXTREME EL NINO FUELS FEARS FOR THE AMAZON AFTER WEEKS OF SEVERE WEATHER",
  "SPAIN: PUIGDEMONT TO RETURN TO SPAIN ON 12 DECEMBER",
  "JAPAN: WIFE OF JOURNALIST HELD IN RUSSIA PLEADS FOR HIS RELEASE",
  "USA: THIRD-QUARTER GDP GROWTH REVISED SHARPLY HIGHER",
  "SOUTH AFRICA: RAMAPHOSA WINS FIGHT TO SET ASIDE PHALA PHALA REPORT",
  "EU: 50 BILLION EURO TECH FUND PLANNED TO RIVAL THE US AND CHINA",
  "USA: TRUMP SPARES TURKEYS FREEDOM AND FEATHERS FOR THANKSGIVING",
];

// ---------------------------------------------------------------- layout
function tagChip(text: string, x: number, y: number, color: number): void {
  const w = textWidth(text, 1) + 14;
  rect(x, y, w, 16, color);
  drawText(text, x + 7, y + 5, 1, WHITE);
}

function drawMasthead(): void {
  hline(20, 20, 984, 2, INK);
  hline(20, 25, 984, 1, INK);
  drawCentered("THE WORLD IN ONE DAY", 512, 36, 5, INK);
  drawCentered("THURSDAY 26 NOVEMBER 2026", 512, 78, 3, RED);
  drawCentered(
    "DATE CHECK: 26 NOVEMBER 2026 WAS A THURSDAY - 31 STORIES ACROSS FIVE CONTINENTS",
    512,
    106,
    1,
    INK,
  );
  rect(20, 120, 984, 2, RED);
  hline(20, 124, 984, 1, INK);
}

function drawLead(): void {
  const x = 20;
  const y = 132;
  const w = 984;
  const h = 140;
  frame(x, y, w, h, INK, 2);
  iconFlameTanker(x + 24, y + 16, 1.55);
  const tx = x + 212;
  tagChip(LEAD.tag, tx, y + 12, RED);
  const headLines = drawBlock(LEAD.headline, tx, y + 36, w - 232, 3, INK, 24);
  drawBlock(LEAD.body, tx, y + 36 + headLines * 24 + 6, w - 232, 1, INK, 10);
}

function drawFeatured(): void {
  const pw = 482;
  const ph = 104;
  const xs = [20, 522];
  const ys = [284, 398, 512];
  FEATURED.forEach((s, i) => {
    const x = xs[i % 2];
    const y = ys[Math.floor(i / 2)];
    rect(x, y, pw, ph, TINT);
    frame(x, y, pw, ph, INK, 1);
    tagChip(s.tag, x + 10, y + 8, s.tagColor);
    s.icon(x + pw - 96, y + 26, 0.9);
    const textW = pw - 118;
    const headLines = drawBlock(s.headline, x + 10, y + 28, textW, 2, INK, 15);
    drawBlock(s.body, x + 10, y + 28 + headLines * 15 + 4, textW, 1, INK, 9);
  });
}

function drawBriefs(): void {
  const y0 = 626;
  rect(20, y0, 984, 26, RED);
  drawText("THE DAY IN BRIEF", 32, y0 + 6, 2, WHITE);
  const right = "24 MORE STORIES";
  drawText(right, 1004 - 12 - textWidth(right, 1), y0 + 9, 1, WHITE);
  const colW = 470;
  const colX = [20, 522];
  BRIEFS.forEach((b, i) => {
    const col = Math.floor(i / 12);
    const row = i % 12;
    const x = colX[col];
    const y = 662 + row * 27;
    rect(x + 2, y + 2, 6, 6, RED);
    drawBlock(b, x + 14, y, colW, 1, INK, 10);
  });
}

function drawFooter(): void {
  hline(20, 992, 984, 1, INK);
  drawCentered("COMPILED FROM WIRE REPORTS - MAKE.FUN NEWS-IMAGE-20261126", 512, 998, 1, INK);
}

function drawPage(): void {
  frame(8, 8, 1008, 1008, INK, 2);
  drawMasthead();
  drawLead();
  drawFeatured();
  drawBriefs();
  drawFooter();
}

// ---------------------------------------------------------------- main
function main(): void {
  drawPage();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

main();
