import { deflateSync } from "node:zlib";

/**
 * 手本の場面の絵に、位置を読み取りやすくするための目盛り(5%ごとの線と、10%ごとの数字)を描いて、PNGにする。
 * AIは目盛りの無い絵だと位置・大きさを5〜10%ずらして読むことがあったため。
 * Remotionに同梱のffmpegには線や文字を描く機能が無く、画像を扱う部品も本番に無いので、画素に直接描いて自前でPNGにする。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** 生の画素(RGB 1画素3バイト)をPNGにする。 */
export const encodePng = (pixels: Uint8Array, width: number, height: number): Buffer => {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
};

/** 数字の形(3×5のます目)。 */
const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

/** 目盛りを描いた絵(元の画素は書き換えない)。10%ごとは濃い赤紫の線と数字、5%ごとは薄い線。 */
export const drawGrid = (pixels: Uint8Array, width: number, height: number): Uint8Array => {
  const out = new Uint8Array(pixels);
  const blend = (x: number, y: number, rgb: [number, number, number], alpha: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(out[i + k] * (1 - alpha) + rgb[k] * alpha);
  };
  const LINE: [number, number, number] = [255, 0, 200];
  for (let p = 5; p < 100; p += 5) {
    const strong = p % 10 === 0;
    const alpha = strong ? 0.75 : 0.35;
    const x = Math.round((width * p) / 100);
    const y = Math.round((height * p) / 100);
    for (let yy = 0; yy < height; yy++) blend(x, yy, LINE, alpha);
    for (let xx = 0; xx < width; xx++) blend(xx, y, LINE, alpha);
  }
  // 数字(10%ごと)。上の端と左の端に、白地に赤紫の数字で書く
  const scale = Math.max(2, Math.round(width / 270));
  const drawNumber = (text: string, left: number, top: number) => {
    const w = text.length * 4 * scale + scale;
    const h = 7 * scale;
    for (let yy = top; yy < top + h; yy++) for (let xx = left; xx < left + w; xx++) blend(xx, yy, [255, 255, 255], 0.85);
    [...text].forEach((ch, index) => {
      const shape = DIGITS[ch];
      if (!shape) return;
      shape.forEach((row, ry) =>
        [...row].forEach((cell, rx) => {
          if (cell !== "1") return;
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) blend(left + scale + (index * 4 + rx) * scale + sx, top + scale + ry * scale + sy, LINE, 1);
        })
      );
    });
  };
  for (let p = 10; p < 100; p += 10) {
    drawNumber(String(p), Math.round((width * p) / 100) + 2, 2);
    drawNumber(String(p), 2, Math.round((height * p) / 100) + 2);
  }
  return out;
};
