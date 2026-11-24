/**
 * 完全模倣(EC-5): 手本の文字を、アプリにある15書体で実際に描いて比べ、書体と「字の色・縁の色」を決める。
 * AIに見て答えさせると、ふつうのゴシックをポップ体と読んだり、字の色と縁の色を取り違えたりしたため、ツールが描いて確かめる。
 *
 * やり方:
 * 1. 縁の色の画素を壁として、切り抜きの外周から塗りつぶし、塗れなかった所(縁に囲まれた内側)にある字の色の画素だけを字とみなす
 *    (縁のさらに外にある白い光や、後ろの白い額縁を字と取り違えないため)。
 * 2. 各書体で同じ文字を大きく描き、手本の字と同じ大きさまで縮める(手本の画質と同じくらいにぼける)。
 * 3. 手本の字の濃さと、描いた字の濃さの似かた(相関)が一番高い書体を選ぶ。
 * 4. 字の色と縁の色を入れ替えた場合も同じように比べ、似かたが高い方を正しい組み合わせとする。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CAPTION_FONT_FAMILY_OPTIONS, type CaptionFontFamily } from "@video/shared/schema";
import { getBrowserInstance } from "@/lib/remotion/browser";

/** 書体ごとの、描く時に使う太さ(動画の文字と同じく、入っている中で一番太い物)。public/fonts のファイル名と合わせる。 */
const FONT_FILES: Record<CaptionFontFamily, { slug: string; weight: string }> = {
  "Noto Sans JP": { slug: "noto-sans-jp", weight: "900" },
  "M PLUS Rounded 1c": { slug: "m-plus-rounded-1c", weight: "700" },
  "Zen Maru Gothic": { slug: "zen-maru-gothic", weight: "700" },
  "Kosugi Maru": { slug: "kosugi-maru", weight: "400" },
  "Zen Kaku Gothic New": { slug: "zen-kaku-gothic-new", weight: "700" },
  "Dela Gothic One": { slug: "dela-gothic-one", weight: "400" },
  "Yusei Magic": { slug: "yusei-magic", weight: "400" },
  "Potta One": { slug: "potta-one", weight: "400" },
  "Reggae One": { slug: "reggae-one", weight: "400" },
  "RocknRoll One": { slug: "rocknroll-one", weight: "400" },
  "Mochiy Pop One": { slug: "mochiy-pop-one", weight: "400" },
  "Noto Serif JP": { slug: "noto-serif-jp", weight: "900" },
  "Shippori Mincho": { slug: "shippori-mincho", weight: "700" },
  Yomogi: { slug: "yomogi", weight: "400" },
  "Kaisei Decol": { slug: "kaisei-decol", weight: "700" },
};

type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const dist = (data: Uint8Array | Buffer, i: number, rgb: Rgb) => Math.hypot(data[i] - rgb[0], data[i + 1] - rgb[1], data[i + 2] - rgb[2]);

/**
 * 切り抜きの中の、字(字の色で、縁に囲まれた内側)の濃さ(0〜1)を、字の外枠に切り詰めて返す。字が見つからなければ null。
 * wall が null の時(縁の無い字)は、字の色の画素をそのまま使う。
 */
export const glyphMask = (
  pixels: Uint8Array | Buffer,
  width: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  fill: string,
  wall: string | null,
  /** 使いたい行の中心(切り抜きの上からの画素)。上下に別の行が入っていたら、これに一番近い行だけを使う。 */
  focusRow?: number
): { values: Float32Array; width: number; height: number } | null => {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (bw < 4 || bh < 4) return null;
  const fillRgb = hexToRgb(fill);
  const soft = new Float32Array(bw * bh);
  const isWall = new Uint8Array(bw * bh);
  const wallRgb = wall ? hexToRgb(wall) : null;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = ((box.y0 + y) * width + box.x0 + x) * 3;
      soft[y * bw + x] = Math.max(0, Math.min(1, 1 - (dist(pixels, i, fillRgb) - 30) / 70));
      if (wallRgb && dist(pixels, i, wallRgb) < 90) isWall[y * bw + x] = 1;
    }
  }
  if (wallRgb) {
    // 外周から、縁(壁)を越えずに塗りつぶす。塗れた所は字の外
    const outside = new Uint8Array(bw * bh);
    const queue: number[] = [];
    const seed = (k: number) => {
      if (!isWall[k] && !outside[k]) {
        outside[k] = 1;
        queue.push(k);
      }
    };
    for (let x = 0; x < bw; x++) {
      seed(x);
      seed((bh - 1) * bw + x);
    }
    for (let y = 0; y < bh; y++) {
      seed(y * bw);
      seed(y * bw + bw - 1);
    }
    while (queue.length > 0) {
      const k = queue.pop()!;
      const x = k % bw;
      const y = (k - x) / bw;
      if (x > 0) seed(k - 1);
      if (x < bw - 1) seed(k + 1);
      if (y > 0) seed(k - bw);
      if (y < bh - 1) seed(k + bw);
    }
    for (let k = 0; k < bw * bh; k++) if (outside[k] || isWall[k]) soft[k] = 0;
  }
  // 字のある行のかたまりに分け、使いたい行に一番近いかたまりだけを残す(上下の別の行を混ぜない)
  if (focusRow !== undefined) {
    const inked = Array.from({ length: bh }, (_, y) => {
      let n = 0;
      for (let x = 0; x < bw; x++) if (soft[y * bw + x] > 0.5) n++;
      return n >= 2;
    });
    const runs: [number, number][] = [];
    for (let y = 0; y < bh; y++) {
      if (!inked[y]) continue;
      const last = runs[runs.length - 1];
      if (last && y - last[1] <= 2) last[1] = y;
      else runs.push([y, y]);
    }
    const tall = runs.filter((run) => run[1] - run[0] >= 3);
    if (tall.length > 1) {
      const keep = tall.reduce((best, run) => (Math.abs((run[0] + run[1]) / 2 - focusRow) < Math.abs((best[0] + best[1]) / 2 - focusRow) ? run : best));
      for (let y = 0; y < bh; y++) if (y < keep[0] - 1 || y > keep[1] + 1) for (let x = 0; x < bw; x++) soft[y * bw + x] = 0;
    }
  }
  let x0 = bw;
  let y0 = bh;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (soft[y * bw + x] <= 0.5) continue;
      count++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (count < 30 || x1 - x0 < 6 || y1 - y0 < 5) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const values = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[y * w + x] = soft[(y0 + y) * bw + x0 + x];
  return { values, width: w, height: h };
};

/** 2つの濃さの並びの似かた(相関。-1〜1)。 */
export const correlation = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
};

// ---------- ブラウザで描く ----------

type DrawPage = { evaluate: (fn: string) => Promise<unknown>; close: () => Promise<void> };
let pagePromise: Promise<DrawPage> | null = null;

/** 書体を読み込んだ、描く用のページ(1つを使い回す)。 */
const drawPage = (): Promise<DrawPage> => {
  if (pagePromise) return pagePromise;
  pagePromise = (async () => {
    const browser = await getBrowserInstance();
    const page = (await browser.newPage({
      context: () => null,
      logLevel: "error",
      indent: false,
      pageIndex: 0,
      onBrowserLog: null,
      onLog: () => undefined,
    })) as unknown as DrawPage;
    // 書体のファイルを読み、ページに渡して読み込ませる(ページはどこにもつながっていないので、ファイルの中身を直接渡す)
    for (const [family, file] of Object.entries(FONT_FILES)) {
      const bytes = await readFile(path.join(process.cwd(), "public", "fonts", file.slug, `${file.slug}-japanese-${file.weight}-normal.woff2`));
      await page.evaluate(`(async () => {
        const b64 = ${JSON.stringify(bytes.toString("base64"))};
        const raw = atob(b64); const buf = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        const face = new FontFace(${JSON.stringify(`M_${family}`)}, buf.buffer, { weight: ${JSON.stringify(file.weight)} });
        await face.load(); document.fonts.add(face); return true;
      })()`);
    }
    return page;
  })().catch((error: unknown) => {
    pagePromise = null;
    throw error;
  });
  return pagePromise;
};

/** 15書体で text を描き、それぞれ width×height に縮めた字の濃さ(0〜1)を返す。 */
const drawAll = async (text: string, width: number, height: number): Promise<Record<string, number[]>> => {
  const page = await drawPage();
  const fonts = Object.entries(FONT_FILES).map(([family, file]) => ({ family, weight: file.weight }));
  return (await page.evaluate(`(() => {
    const out = {};
    for (const f of ${JSON.stringify(fonts)}) {
      const c = document.createElement('canvas'); c.width = 3400; c.height = 320; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      x.font = f.weight + ' 220px "M_' + f.family + '"'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
      x.fillText(${JSON.stringify(text)}, 40, 160);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let a = c.width, b = c.height, e = -1, g = -1;
      for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4] > 128) { if (xx < a) a = xx; if (y < b) b = y; if (xx > e) e = xx; if (y > g) g = y; }
      if (e < 0) { out[f.family] = []; continue; }
      const s = document.createElement('canvas'); s.width = ${width}; s.height = ${height}; const sx = s.getContext('2d');
      sx.imageSmoothingQuality = 'high'; sx.drawImage(c, a, b, e - a + 1, g - b + 1, 0, 0, ${width}, ${height});
      const p = sx.getImageData(0, 0, ${width}, ${height}).data; const v = []; for (let i = 0; i < p.length; i += 4) v.push(p[i] / 255);
      out[f.family] = v;
    }
    return out;
  })()`)) as Record<string, number[]>;
};

/** scoreOfCurrent は、もとの(AIが答えた)書体の似かた。 */
export type DrawMatch = { fontFamily: CaptionFontFamily; swapped: boolean; score: number; scoreOfCurrent?: number };

/** この値より似ていなければ、描いて比べた結果は使わない(字の形を取り出せていない)。 */
export const MIN_MATCH_SCORE = 0.45;

/**
 * 手本の文字(字の色 color・縁の色 strokeColor)を、15書体で描いて比べ、一番近い書体と、字と縁の色を入れ替えるべきかを返す。
 * 比べられなかった時は null。pixels は RGB の画素(幅 width)、box は字の箱(画素)。
 */
export const matchLook = async (input: Parameters<typeof bestLook>[0]): Promise<DrawMatch | null> => {
  const best = await bestLook(input);
  return best && best.score >= MIN_MATCH_SCORE ? best : null;
};

/** 描いて比べた一番近い書体(似かたの基準を問わない。記録に出すため)。 */
export const bestLook = async (input: {
  pixels: Uint8Array | Buffer;
  width: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 使いたい行の中心(画面の上からの画素)。 */
  centerY?: number;
  text: string;
  color: string;
  strokeColor: string | null;
  /** もとの(AIが答えた)書体。 */
  currentFont?: string;
  /** E44: 字の中と縁の色がもう決まっている時は true(入れ替えた形では比べない)。 */
  orderFixed?: boolean;
}): Promise<DrawMatch | null> => {
  const text = input.text.replace(/\s+/g, "");
  if (!text) return null;
  const hypotheses = [{ fill: input.color, wall: input.strokeColor, swapped: false }];
  if (input.strokeColor && !input.orderFixed) hypotheses.push({ fill: input.strokeColor, wall: input.color, swapped: true });
  let best: DrawMatch | null = null;
  let currentScore = -1;
  for (const hypothesis of hypotheses) {
    const glyph = glyphMask(
      input.pixels,
      input.width,
      input.box,
      hypothesis.fill,
      hypothesis.wall,
      input.centerY !== undefined ? input.centerY - input.box.y0 : undefined
    );
    if (!glyph) continue;
    const drawn = await drawAll(text, glyph.width, glyph.height);
    for (const option of CAPTION_FONT_FAMILY_OPTIONS) {
      const values = drawn[option.value];
      if (!values || values.length === 0) continue;
      const score = correlation(glyph.values, values);
      if (option.value === input.currentFont && score > currentScore) currentScore = score;
      if (!best || score > best.score) best = { fontFamily: option.value, swapped: hypothesis.swapped, score };
    }
  }
  return best && currentScore >= 0 ? { ...best, scoreOfCurrent: currentScore } : best;
};
