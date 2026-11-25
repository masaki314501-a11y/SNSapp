/**
 * 完全模倣(グループ2 出し方): 手本の字幕が出る時の動きを、画面から測って決める(AIに選ばせない)。
 * その見た目の字幕が初めて写っている秒の手前を0.1秒ごとに見て、字の色の画素の数と、横の広がりを数える。
 * 見分け方は motionOf を参照。
 */
import { RenderInternals } from "@remotion/renderer";

export type MeasuredMotion = "none" | "pop" | "blur-in";

const callFf = (args: string[]) =>
  RenderInternals.callFf({
    bin: "ffmpeg",
    args,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  });

const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** 箱の中の、字の色に近い画素の数と、その左右の広がり(箱の幅に対する割合)。 */
export const inkOf = (pixels: Uint8Array, width: number, height: number, box: { x0: number; x1: number; y0: number; y1: number }, color: string) => {
  const [r, g, b] = hexToRgb(color);
  let count = 0;
  let left = Infinity;
  let right = -Infinity;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * width + x) * 3;
      if (Math.hypot(pixels[i] - r, pixels[i + 1] - g, pixels[i + 2] - b) > 60) continue;
      count++;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  return { count, spread: count > 0 ? (right - left) / Math.max(1, box.x1 - box.x0) : 0 };
};

/**
 * 0.1秒ごとの量と幅の並びから、動きを決める。最後の絵を、出終わった形とする。
 * - ぼかしからくっきり: ぼやけた字が広がって数が増え、3回続けて1割以上ずつ減りながら(その間ずっと最後の1.15倍より多い)くっきりする
 *   (手本の「治療期間も目立たない」は、白の画素が最後の約4倍まで増えてから減った)
 * - 弾む拡大: 最後の幅に届いた後で、幅が最後の9割以下に縮んでから戻る(手本の「完全オーダーメイド」は 0.81→0.66→0.78)
 * - どちらでもなければ、ぱっと出る(前の字幕から、いきなり替わる)
 */
export const motionOf = (frames: { count: number; spread: number }[]): MeasuredMotion | null => {
  const final = frames[frames.length - 1];
  if (!final || final.count < 50) return null;
  for (let i = 0; i + 3 < frames.length; i++) {
    const run = frames.slice(i, i + 4);
    if (run.every((frame, k) => k === 0 || (frame.count <= run[k - 1].count * 0.9 && run[k - 1].count > final.count * 1.15))) return "blur-in";
  }
  let reached = false;
  for (const frame of frames) {
    if (frame.count >= final.count * 0.5 && frame.spread >= final.spread * 0.98) reached = true;
    else if (reached && frame.count > 0 && frame.spread <= final.spread * 0.9) return "pop";
  }
  return "none";
};

/**
 * 手本の、ある見た目の字幕が出る時の動きを測る。firstSeen はその字幕が初めて写っていた秒(1秒ごとに見た秒)。
 * 箱は画面に対する%。測れなければ null。
 */
export const measureMotion = async (
  absolutePath: string,
  firstSeen: number,
  box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  color: string
): Promise<MeasuredMotion | null> => {
  const width = 540;
  const height = 960;
  const pad = 0.2;
  const area = {
    x0: Math.max(0, Math.round(((box.xPercent - (box.widthPercent / 2) * (1 + pad)) / 100) * width)),
    x1: Math.min(width, Math.round(((box.xPercent + (box.widthPercent / 2) * (1 + pad)) / 100) * width)),
    y0: Math.max(0, Math.round(((box.yPercent - (box.heightPercent / 2) * (1 + pad)) / 100) * height)),
    y1: Math.min(height, Math.round(((box.yPercent + (box.heightPercent / 2) * (1 + pad)) / 100) * height)),
  };
  // 初めて写っていた秒の1秒前から0.6秒後まで、0.1秒ごとに見る。出終わった形は、いちばん後の絵
  const frames: { count: number; spread: number }[] = [];
  for (let step = 0; step <= 16; step++) {
    const seconds = Math.max(0, firstSeen - 1 + step * 0.1);
    const result = await callFf([
      "-v", "error", "-ss", seconds.toFixed(2), "-i", absolutePath, "-frames:v", "1", "-vf", `scale=${width}:${height}`,
      "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2pipe", "-",
    ]).catch(() => null);
    const pixels = result ? new Uint8Array(result.stdout as unknown as Buffer) : null;
    if (!pixels || pixels.length < width * height * 3) return null;
    frames.push(inkOf(pixels, width, height, area, color));
  }
  return motionOf(frames);
};
