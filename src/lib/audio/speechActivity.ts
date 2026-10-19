import { stat } from "node:fs/promises";
import { RenderInternals } from "@remotion/renderer";

/**
 * 動画の音から「話している所」と「間(無音)」を調べる。
 * - カットの位置を間に寄せる(AIが決めた秒数のままだと、言葉の頭や語尾が少し切れることがあった)
 * - 字幕を、話している所に合わせて言葉ごとに光らせる・出す(字幕は1クリップぶんがずっと全文出ていた)
 * の両方に使う。音を取り出すのは、Remotionに同梱されているffmpeg(本番のサーバーにも入っている)で行い、
 * 外部のサービスは使わない(料金がかからない)。8kHz・モノラルに落として音の大きさだけを見るので軽い
 * (80秒の動画で0.2秒ほど)。
 */

/** 音の大きさを測る間隔(秒)。 */
export const FRAME_SECONDS = 0.01;
const SAMPLE_RATE = 8000;
const SAMPLES_PER_FRAME = Math.round(SAMPLE_RATE * FRAME_SECONDS);

export type SpeechActivity = {
  /** 10msごとの音の大きさ(dB。0が最大、無音ほど小さい)。 */
  levels: Float32Array;
  /** 背景の雑音の大きさ(dB)。これより十分大きい所を「話している」とみなす。 */
  noiseFloorDb: number;
  /** 話している区間(元の動画の秒数)。 */
  spans: [number, number][];
};

/** 背景の雑音より、この分(dB)大きければ「話している」とみなす。 */
const SPEECH_ABOVE_FLOOR_DB = 12;
/** これより短い間は、話の途中の息継ぎとしてつなげる(秒)。 */
const MERGE_GAP_SECONDS = 0.15;
/** これより短い音は、話ではない物音として捨てる(秒)。 */
const MIN_SPAN_SECONDS = 0.08;

/** WAVの中から音の生データ(16bit)の部分を取り出す。ヘッダーの長さは書き出し方で変わるので、"data"の目印を探す。 */
const pcmFromWav = (wav: Buffer): Int16Array => {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") {
      const start = offset + 8;
      // ffmpegは書き出し中に長さが分からないので、大きさの欄に仮の値を入れることがある。その時は最後まで読む
      const end = size > 0 && start + size <= wav.length ? start + size : wav.length;
      const bytes = wav.subarray(start, end - ((end - start) % 2));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("音のデータが見つかりませんでした");
};

/** 音の大きさ(10msごと)から、話している区間を出す。 */
export const detectSpeechSpans = (levels: Float32Array, noiseFloorDb: number): [number, number][] => {
  const threshold = noiseFloorDb + SPEECH_ABOVE_FLOOR_DB;
  const raw: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= levels.length; i++) {
    const loud = i < levels.length && levels[i] >= threshold;
    if (loud && start < 0) start = i;
    if (!loud && start >= 0) {
      raw.push([start * FRAME_SECONDS, i * FRAME_SECONDS]);
      start = -1;
    }
  }
  const merged: [number, number][] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span[0] - last[1] < MERGE_GAP_SECONDS) last[1] = span[1];
    else merged.push([span[0], span[1]]);
  }
  return merged
    .filter(([a, b]) => b - a >= MIN_SPAN_SECONDS)
    .map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
};

/** 音の生データから、10msごとの音の大きさと背景の雑音の大きさを出す。 */
export const measureLevels = (pcm: Int16Array): { levels: Float32Array; noiseFloorDb: number } => {
  const frames = Math.floor(pcm.length / SAMPLES_PER_FRAME);
  const levels = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * SAMPLES_PER_FRAME; i < (f + 1) * SAMPLES_PER_FRAME; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / SAMPLES_PER_FRAME) / 32768;
    levels[f] = 20 * Math.log10(Math.max(rms, 1e-6));
  }
  // 背景の雑音: 静かな方から1割くらいの所の大きさ(間が少ない動画でも、話している所を雑音と取り違えないように)
  const sorted = Float32Array.from(levels).sort();
  const noiseFloorDb = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.1)] : -60;
  return { levels, noiseFloorDb };
};

const cache = new Map<string, { mtimeMs: number; activity: SpeechActivity }>();
/** 覚えておく動画の数(1本あたり、10分の動画で約240KB)。 */
const MAX_CACHE = 8;

/** 動画の音を調べる。同じ動画は覚えておいて、2回目からは調べ直さない。 */
export const analyzeSpeechActivity = async (absoluteVideoPath: string): Promise<SpeechActivity> => {
  const { mtimeMs } = await stat(absoluteVideoPath);
  const cached = cache.get(absoluteVideoPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.activity;

  const result = await RenderInternals.callFf({
    bin: "ffmpeg",
    // ffmpegは自分の置き場所で動くので、動画の場所は絶対パスで渡す
    args: ["-v", "error", "-i", absoluteVideoPath, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav", "-"],
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    // encoding: "buffer" で、出力を文字ではなく生のバイト列のまま受け取る(型は文字のままなので直す)
    options: { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
  });
  const { levels, noiseFloorDb } = measureLevels(pcmFromWav(result.stdout as unknown as Buffer));
  const activity: SpeechActivity = { levels, noiseFloorDb, spans: detectSpeechSpans(levels, noiseFloorDb) };
  cache.set(absoluteVideoPath, { mtimeMs, activity });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return activity;
};

/** カットの位置を寄せる範囲(秒)。これより遠い間には寄せない(話の区切りを変えてしまうため)。 */
const SNAP_WINDOW_SECONDS = 0.35;
/** 寄せ先として認める静かさ(背景の雑音からこのdB以内)。十分静かな所が無ければ寄せない。 */
const QUIET_ABOVE_FLOOR_DB = 6;

/**
 * カットの位置(元の動画の秒数)を、近くの一番静かな所へ寄せる。言葉の途中で切れないようにするため。
 * 近くに十分静かな所が無ければ(話が切れ目なく続いている所)、そのままにする。
 */
export const snapToQuiet = (activity: SpeechActivity, seconds: number): number => {
  const { levels, noiseFloorDb } = activity;
  const center = Math.round(seconds / FRAME_SECONDS);
  const radius = Math.round(SNAP_WINDOW_SECONDS / FRAME_SECONDS);
  let best = -1;
  let bestScore = Infinity;
  for (let f = Math.max(0, center - radius); f <= Math.min(levels.length - 1, center + radius); f++) {
    if (levels[f] > noiseFloorDb + QUIET_ABOVE_FLOOR_DB) continue;
    // 静かさを優先し、同じくらい静かなら元の位置に近い方
    const score = levels[f] + Math.abs(f - center) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best < 0 ? seconds : Math.round(best * FRAME_SECONDS * 100) / 100;
};
