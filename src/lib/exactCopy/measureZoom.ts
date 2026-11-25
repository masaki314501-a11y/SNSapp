/**
 * 完全模倣(C13 寄りの強さ): 手本の寄りの倍率を、画面から測る(AIが目で読んだ倍率は使わない)。
 * 画面が切り替わった秒(events.ts で測った秒)の少し前と少し後で、顔(肌の色のいちばん大きいかたまり)の面積を比べ、
 * 倍率 = √(後の面積 ÷ 前の面積)。寄った所(1.04〜1.4倍)の真ん中の値を、手本の寄りの強さとする。
 */
import { RenderInternals } from "@remotion/renderer";

const W = 270;
const H = 480;

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

/** 肌の色(明るさ・赤み・青みの範囲)の画素の、いちばん大きいつながりの画素の数。 */
export const largestSkinArea = (rgb: Uint8Array, width: number, height: number): number => {
  const mask = new Uint8Array(width * height);
  for (let y = Math.round(height * 0.05); y < height * 0.6; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (luma > 70 && cr > 135 && cr < 175 && cb > 85 && cb < 128) mask[y * width + x] = 1;
    }
  }
  const seen = new Uint8Array(width * height);
  let best = 0;
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || seen[k]) continue;
    const queue = [k];
    seen[k] = 1;
    let count = 0;
    while (queue.length > 0) {
      const at = queue.pop()!;
      count++;
      const x = at % width;
      for (const step of [1, -1, width, -width]) {
        const next = at + step;
        if (next < 0 || next >= mask.length || !mask[next] || seen[next] || Math.abs((next % width) - x) > 1) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    best = Math.max(best, count);
  }
  return best;
};

/** 倍率の並びから、寄った所(1.04〜1.4倍)の真ん中の値。寄った所が2つ未満なら null。 */
export const zoomScaleOf = (ratios: number[]): number | null => {
  const zoomed = ratios.filter((ratio) => ratio >= 1.04 && ratio <= 1.4).sort((a, b) => a - b);
  if (zoomed.length < 2) return null;
  return Math.round(zoomed[Math.floor(zoomed.length / 2)] * 100) / 100;
};

const skinAt = async (absolutePath: string, seconds: number): Promise<number | null> => {
  const result = await callFf([
    "-v", "error", "-ss", String(Math.max(0, seconds)), "-i", absolutePath, "-frames:v", "1", "-vf", `scale=${W}:${H}`,
    "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2pipe", "-",
  ]).catch(() => null);
  const pixels = result ? new Uint8Array(result.stdout as unknown as Buffer) : null;
  return pixels && pixels.length >= W * H * 3 ? largestSkinArea(pixels, W, H) : null;
};

/** 手本の寄りの倍率を測る。測れなければ null(その時は寄りの強さを変えない)。 */
export const measureZoomScale = async (absolutePath: string, changes: number[]): Promise<number | null> => {
  const ratios: number[] = [];
  for (const seconds of changes) {
    const [before, after] = [await skinAt(absolutePath, seconds - 0.3), await skinAt(absolutePath, seconds + 0.4)];
    if (before && after && before > 200) ratios.push(Math.sqrt(after / before));
  }
  const scale = zoomScaleOf(ratios);
  console.info(`[exactCopy] 手本の寄りの倍率(画面から測定): ${ratios.map((ratio) => ratio.toFixed(2)).join("・")} → ${scale ?? "測れない"}`);
  return scale;
};
