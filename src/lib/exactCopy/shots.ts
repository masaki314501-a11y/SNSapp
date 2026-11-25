/**
 * 完全模倣(B8 同じ画角が続く長さ・A4 全体のテンポ): 寄りを、手本の画面の切り替わり方に合わせて置く。
 * - 元の動画の別の所へ飛ぶ切れ目が、画面で見て変わるかを、前後の絵を比べて測る(手本の切り替わりと同じ測り方。events.ts の changeTimes)。
 * - 寄りも見える切れ目も無く、手本のいちばん長い画角より長く続く所に、手本と同じ「ぱっと寄る」を足す。
 * - 全体の切り替わりが多すぎる(10秒あたり maxPerTen を超える)時は、ほかの切り替わりに近すぎる強調の寄りから外す
 *   (その寄りの効果音も外す)。外すと長く続く所ができる寄りは外さない。
 */
import { RenderInternals } from "@remotion/renderer";
import type { ProjectSegment } from "@/lib/videoProject";

const W = 72;
const H = 128;
/** 人の映っている所(縦15〜55%)の明るさが、これ以上変わったら切り替わり(events.ts と同じ)。 */
const CHANGE_THRESHOLD = 18;

const grayAt = async (absolutePath: string, seconds: number): Promise<Uint8Array | null> => {
  const result = await RenderInternals.callFf({
    bin: "ffmpeg",
    args: ["-v", "error", "-ss", Math.max(0, seconds).toFixed(3), "-i", absolutePath, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-pix_fmt", "gray", "-c:v", "rawvideo", "-f", "image2pipe", "-"],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 1024 * 1024 },
  }).catch(() => null);
  const pixels = result ? new Uint8Array(result.stdout as unknown as Buffer) : null;
  return pixels && pixels.length >= W * H ? pixels : null;
};

/** 2枚の絵の、人の映っている所の明るさの差(0〜255の平均)。 */
export const frameDifference = (a: Uint8Array, b: Uint8Array): number => {
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(H * 0.15); y < H * 0.55; y++) {
    for (let x = 0; x < W; x++) {
      sum += Math.abs(a[y * W + x] - b[y * W + x]);
      n++;
    }
  }
  return sum / n;
};

/** 元の動画の別の所へ飛ぶ切れ目のうち、画面で見て変わる物(その字幕の番号)。 */
export const visibleCutsOf = async (absolutePath: string, segments: ProjectSegment[]): Promise<Set<number>> => {
  const visible = new Set<number>();
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1];
    const segment = segments[i];
    if (Math.abs(previous.startFromSeconds + previous.durationInSeconds - segment.startFromSeconds) <= 0.3) continue;
    const [before, after] = [
      await grayAt(absolutePath, previous.startFromSeconds + previous.durationInSeconds - 0.05),
      await grayAt(absolutePath, segment.startFromSeconds + 0.05),
    ];
    if (before && after && frameDifference(before, after) > CHANGE_THRESHOLD) visible.add(i);
  }
  return visible;
};

/** 切り替わりの秒(見える切れ目・寄りの入りと終わり)。 */
export const changeSecondsOf = (segments: ProjectSegment[], visible: Set<number>): number[] => {
  const changes: number[] = [];
  let at = 0;
  segments.forEach((segment, i) => {
    const start = at;
    at += segment.durationInSeconds;
    const zoomed = !!segment.zoom;
    const prevZoomed = i > 0 && !!segments[i - 1].zoom;
    if (visible.has(i) || zoomed !== prevZoomed) changes.push(start);
  });
  return changes;
};

const longestGap = (changes: number[], total: number) => {
  const points = [0, ...changes, total];
  return Math.max(...points.slice(1).map((value, i) => value - points[i]));
};

export const balanceShots = (
  segments: ProjectSegment[],
  options: {
    visible: Set<number>;
    /** 手本のいちばん長い画角(秒)。 */
    limitSeconds: number;
    scale: number;
    /** 10秒あたりの切り替わりの上限。 */
    maxPerTen: number;
    /** 寄りを足さない字幕(丸が付く字幕など)。start・end は完成動画の秒。 */
    skip: (start: number, end: number) => boolean;
  }
): ProjectSegment[] => {
  const total = segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0);
  const result = [...segments];
  const added = new Set<number>();
  // 1. 長く続く所に寄りを足す(次の切り替わりまでが手本のいちばん長い画角を超えるなら、今の字幕で寄る)
  const starts: number[] = [];
  let edge = 0;
  for (const segment of result) {
    starts.push(edge);
    edge += segment.durationInSeconds;
  }
  const nextChangeAfter = (i: number) => {
    for (let k = i + 1; k < result.length; k++) if (result[k].zoom || options.visible.has(k)) return starts[k];
    return total;
  };
  let lastChange = 0;
  let at = 0;
  result.forEach((segment, i) => {
    const start = at;
    const end = at + segment.durationInSeconds;
    at = end;
    if (options.visible.has(i)) lastChange = start;
    if (segment.zoom) {
      lastChange = end;
      return;
    }
    const continued = i > 0 && result[i - 1].caption.trim() !== "" && result[i - 1].caption === segment.caption;
    const prevZoomed = Boolean(result[i - 1]?.zoom);
    const tooLong = nextChangeAfter(i) - lastChange > options.limitSeconds;
    if (tooLong && start - lastChange >= 1 && !continued && !prevZoomed && !options.skip(start, end)) {
      result[i] = {
        ...segment,
        zoom: { scale: options.scale, style: "punch", focusXPercent: segment.faceBox?.xPercent ?? 50, focusYPercent: segment.faceBox?.yPercent ?? 40 },
      };
      added.add(i);
      lastChange = end;
    }
  });
  // 2. 切り替わりが多すぎる時は、ほかの切り替わりに近すぎる強調の寄りから外す
  const maxChanges = Math.floor((options.maxPerTen * total) / 10);
  for (let guard = 0; guard < result.length; guard++) {
    const changes = changeSecondsOf(result, options.visible);
    if (changes.length <= maxChanges) break;
    const currentGap = longestGap(changes, total);
    let best: { index: number; crowd: number } | null = null;
    let start = 0;
    result.forEach((segment, i) => {
      const segmentStart = start;
      start += segment.durationInSeconds;
      if (!segment.zoom || added.has(i)) return;
      const trial = result.map((item, k) => (k === i ? { ...item, zoom: undefined } : item));
      const trialChanges = changeSecondsOf(trial, options.visible);
      if (longestGap(trialChanges, total) > Math.max(options.limitSeconds, currentGap)) return;
      const others = changes.filter((change) => Math.abs(change - segmentStart) > 0.01);
      const crowd = Math.min(...others.map((change) => Math.abs(change - segmentStart)));
      if (!best || crowd < best.crowd) best = { index: i, crowd };
    });
    if (!best) break;
    const index = (best as { index: number }).index;
    result[index] = { ...result[index], zoom: undefined, emphasisSfxPresetId: undefined };
  }
  return result;
};
