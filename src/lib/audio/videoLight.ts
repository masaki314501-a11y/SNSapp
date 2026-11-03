import { RenderInternals } from "@remotion/renderer";
import type { FaceBox, VideoAdjust } from "@video/shared/schema";

/**
 * 映像の明るさを測り、人が明るく見えるように補正の値(明るさ・コントラスト・彩度)を決める
 * (チェック項目: 人間が美しく見えるよう光が補正されているか)。
 * Remotionに同梱のffmpegで、使う範囲からいくつかの場面を小さな白黒の絵として取り出し、明るさの平均とばらつきを見る。
 */

/** 取り出す絵の幅(px)。明るさの平均を見るだけなので小さくてよい。 */
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 114;
/** 目標の明るさ(0〜255の平均)。顔を測る時は、肌が明るく見えるくらい。顔が分からない時は画面全体で見る。 */
const TARGET_FACE_MEAN = 150;
const TARGET_FRAME_MEAN = 125;
/** これくらいのずれなら明るさは変えない(割合)。 */
const BRIGHTNESS_TOLERANCE = 0.06;
/** 明るさのばらつき(標準偏差)がこれより小さければ、メリハリが無いのでコントラストを少し上げる。 */
const FLAT_STD = 45;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/** 指定した秒の場面を、小さな白黒の絵(1画素1バイト)として取り出す。 */
const grayFrame = async (absoluteVideoPath: string, seconds: number): Promise<Uint8Array> => {
  const result = await RenderInternals.callFf({
    bin: "ffmpeg",
    args: [
      "-v", "error", "-ss", String(seconds), "-i", absoluteVideoPath, "-frames:v", "1",
      "-vf", `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`, "-pix_fmt", "gray", "-c:v", "rawvideo", "-f", "image2pipe", "-",
    ],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  });
  return new Uint8Array(result.stdout as unknown as Buffer);
};

/** 明るさの平均と標準偏差から、補正の値を決める。補正が要らなければnull。 */
export const lightAdjustFor = (mean: number, std: number, target = TARGET_FRAME_MEAN): VideoAdjust | null => {
  const ratio = target / Math.max(1, mean);
  // 暗くするのは少しまで(白い壁などで全体が明るくても、人を暗くしないため)
  const brightness = Math.abs(ratio - 1) <= BRIGHTNESS_TOLERANCE ? 1 : round2(clamp(ratio, 0.95, 1.35));
  const contrast = std < FLAT_STD ? 1.08 : 1;
  // 肌の血色が良く見えるよう、彩度はいつも少しだけ上げる
  const saturation = 1.05;
  return { brightness, contrast, saturation };
};

/**
 * 使う範囲(元の動画の秒数)から5場面を取り出して明るさを測り、補正の値を決める。
 * 顔の位置が分かれば、顔の部分の明るさで決める(背景の白い壁などに引っぱられて、人を暗くしないため)。
 */
export const measureLightAdjust = async (
  absoluteVideoPath: string,
  ranges: { start: number; end: number }[],
  face?: FaceBox
): Promise<{ adjust: VideoAdjust | null; mean: number }> => {
  const total = ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
  if (total <= 0) return { adjust: null, mean: 0 };
  // 使う範囲を均等に5つに分けた真ん中の時刻
  const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((ratio) => {
    let rest = total * ratio;
    for (const range of ranges) {
      if (rest <= range.end - range.start) return range.start + rest;
      rest -= range.end - range.start;
    }
    return ranges.at(-1)!.end - 0.1;
  });
  const inFace = (index: number) => {
    if (!face) return true;
    const x = ((index % SAMPLE_WIDTH) / SAMPLE_WIDTH) * 100;
    const y = (Math.floor(index / SAMPLE_WIDTH) / SAMPLE_HEIGHT) * 100;
    return Math.abs(x - face.xPercent) <= face.widthPercent / 2 && Math.abs(y - face.yPercent) <= face.heightPercent / 2;
  };
  const pixels: number[] = [];
  for (const time of times) {
    const frame = await grayFrame(absoluteVideoPath, time).catch(() => new Uint8Array());
    frame.forEach((value, index) => {
      if (inFace(index)) pixels.push(value);
    });
  }
  if (pixels.length === 0) return { adjust: null, mean: 0 };
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const std = Math.sqrt(pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length);
  return { adjust: lightAdjustFor(mean, std, face ? TARGET_FACE_MEAN : TARGET_FRAME_MEAN), mean: Math.round(mean) };
};
