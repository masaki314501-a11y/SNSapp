/**
 * 手本の音から効果音とBGMを自動で切り出し、型に入れる(普通の生成・完全模倣の両方で使う)。
 * 1. scripts/reference_sounds.py で、声とそれ以外の音を分け(demucs)、BGMの拍ではない、急に大きくなる音を切り出す
 * 2. 手本の画面で、字幕の所が変わった時刻(0.05秒ごとに測る)と同時に鳴った音を、その時に出た強調の見た目の音にする
 *    (どの見た目かは、型づくりで1秒ごとに読んだ字幕の見た目で決める)。締めの段に移る時に鳴った音は、締めの音にする
 * 声を分ける Python(SOUND_SEPARATION_PYTHON)が無い所では、切り出さない(今まで通り手持ちの効果音)。
 * 切り出した音は public/audio/exact-sfx/<手本のID>/ に置く(書き出しは /api/media から読む)。
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RenderInternals } from "@remotion/renderer";
import type { ReferenceTemplate } from "@/lib/editSteps/template";

export type CutSound = { file: string; start: number; length: number; db: number };
type CutResult = { sounds: CutSound[]; bgm: string };

const SCRIPT = path.join(process.cwd(), "scripts", "reference_sounds.py");
const OUT_ROOT = path.join(process.cwd(), "public", "audio", "exact-sfx");
const SEPARATE_TIMEOUT_MS = 15 * 60 * 1000;

const callFf = (args: string[]) =>
  RenderInternals.callFf({
    bin: "ffmpeg",
    args,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  });

const separationPython = (): string | null => {
  const value = process.env.SOUND_SEPARATION_PYTHON?.trim();
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
};

/** 手本の音から、効果音の候補とBGMを切り出す(同じ手本なら、前に切り出した物)。できなければ null。 */
export const cutReferenceSounds = async (absolutePath: string, id: string): Promise<CutResult | null> => {
  const python = separationPython();
  if (!python) return null;
  const outDir = path.join(OUT_ROOT, id);
  const listPath = path.join(outDir, "sounds.json");
  const saved = await readFile(listPath, "utf8").then((text) => JSON.parse(text) as CutResult).catch(() => null);
  if (saved) return saved;
  const work = path.join(os.tmpdir(), `reference-sounds-${id}`);
  await mkdir(work, { recursive: true });
  const wav = path.join(work, "reference.wav");
  try {
    await callFf(["-v", "error", "-y", "-i", absolutePath, "-vn", "-ac", "2", "-ar", "44100", wav]);
    const stdout = await new Promise<string>((resolve, reject) =>
      execFile(python, [SCRIPT, wav, outDir], { timeout: SEPARATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, out) =>
        error ? reject(error) : resolve(String(out))
      )
    );
    const line = stdout.trim().split("\n").pop() ?? "";
    const result = JSON.parse(line) as CutResult;
    await writeFile(listPath, JSON.stringify(result, null, 2));
    console.info(`[referenceSounds] 手本の効果音の候補: ${result.sounds.map((sound) => `${sound.start}秒`).join("・") || "なし"}`);
    return result;
  } catch (error) {
    console.warn("[referenceSounds] 手本の音を切り出せませんでした", error);
    return null;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
};

const BAND_W = 72;
const BAND_H = 40;
const FPS = 20;
/** 字幕の所の明るさが、これ以上変わったら、字幕が変わった(0〜255の平均)。 */
const CHANGE_THRESHOLD = 10;

/** 手本の字幕の所(縦 topPercent〜bottomPercent)が変わった時刻(秒)。 */
export const captionChangeTimes = async (absolutePath: string, topPercent: number, bottomPercent: number): Promise<number[]> => {
  const top = Math.max(0, Math.min(95, topPercent)) / 100;
  const height = Math.max(5, Math.min(100 - topPercent, bottomPercent - topPercent)) / 100;
  const result = await callFf([
    "-v", "error", "-i", absolutePath, "-an",
    "-vf", `crop=iw:ih*${height.toFixed(3)}:0:ih*${top.toFixed(3)},scale=${BAND_W}:${BAND_H}`,
    // この ffmpeg には fps の仕組みが無いので、出力のコマ数で決める
    "-r", String(FPS),
    "-pix_fmt", "gray", "-c:v", "rawvideo", "-f", "image2pipe", "-",
  ]).catch(() => null);
  if (!result) return [];
  const pixels = new Uint8Array(result.stdout as unknown as Buffer);
  const size = BAND_W * BAND_H;
  const frames = Math.floor(pixels.length / size);
  const diffs: number[] = [0];
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.abs(pixels[f * size + i] - pixels[(f - 1) * size + i]);
    diffs.push(sum / size);
  }
  return changePeaks(diffs, FPS, CHANGE_THRESHOLD);
};

/** 明るさの変わり方の並びから、大きく変わった時刻(近い物は1つにまとめる)。 */
export const changePeaks = (diffs: number[], fps: number, threshold: number): number[] => {
  const times: number[] = [];
  for (let f = 1; f < diffs.length; f++) {
    if (diffs[f] < threshold || diffs[f] < diffs[f - 1] || diffs[f] < (diffs[f + 1] ?? 0)) continue;
    const seconds = f / fps;
    if (times.length > 0 && seconds - times[times.length - 1] < 0.2) continue;
    times.push(Math.round(seconds * 100) / 100);
  }
  return times;
};

/**
 * 切り出した音を、強調の見た目と締めに結び付ける。
 * - 強調: 字幕の所が変わった時刻(音の始めの0.15秒前〜0.25秒後)と同時に鳴り、そのすぐ後(0.1秒前〜1.05秒後)に読んだ字幕がその見た目だった音。
 *   1つの見た目には、最初に結び付いた音を使う
 * - 締め: 締めの段が始まった時刻(0.25秒ごとに読んだ)の0.35秒前〜0.15秒後に鳴った音
 * 戻り値は、音の番号(結び付かなければ null)。
 */
export const matchReferenceSounds = (input: {
  sounds: { start: number }[];
  captionChanges: number[];
  /** 強調の見た目ごとに、その見た目の字幕を読んだ秒(1秒ごと)。 */
  styleSeen: number[][];
  /** 締めの段が始まった秒。 */
  stageStarts: number[];
}): { styles: (number | null)[]; closing: number | null } => {
  const styles: (number | null)[] = input.styleSeen.map(() => null);
  let closing: number | null = null;
  input.sounds.forEach((sound, index) => {
    const o = sound.start;
    if (closing === null && input.stageStarts.some((start) => o >= start - 0.35 && o <= start + 0.15)) {
      closing = index;
      return;
    }
    if (!input.captionChanges.some((change) => change >= o - 0.15 && change <= o + 0.25)) return;
    const style = input.styleSeen.findIndex((seen) => seen.some((seconds) => seconds >= o - 0.1 && seconds <= o + 1.05));
    if (style >= 0 && styles[style] === null) styles[style] = index;
  });
  return { styles, closing };
};

/** 型に、手本から切り出した効果音・締めの音・BGMを入れる(結び付いた音だけ)。 */
export const withReferenceSounds = (
  template: ReferenceTemplate,
  id: string,
  cut: CutResult,
  matched: { styles: (number | null)[]; closing: number | null }
): ReferenceTemplate => {
  const idOf = (file: string) => `exact:audio/exact-sfx/${id}/${file}`;
  const sounds: { id: string; label: string }[] = [];
  const emphasisStyles = template.emphasisStyles.map((style, i) => {
    const index = matched.styles[i];
    if (index === null || index === undefined || !cut.sounds[index]) return style;
    const sound = cut.sounds[index];
    sounds.push({ id: idOf(sound.file), label: `手本で、${style.role}の強調が出た時の音(${sound.start}秒)` });
    return { ...style, sound: idOf(sound.file) };
  });
  const closingSound = matched.closing !== null && cut.sounds[matched.closing] ? idOf(cut.sounds[matched.closing].file) : undefined;
  if (closingSound) sounds.push({ id: closingSound, label: `手本で、締めの段に移る時の音(${cut.sounds[matched.closing!].start}秒)` });
  return {
    ...template,
    emphasisStyles,
    ...(sounds.length > 0 ? { sounds } : {}),
    ...(closingSound ? { closingSound } : {}),
    ...(cut.bgm ? { bgm: { src: `audio/exact-sfx/${id}/${cut.bgm}`, volume: 1 } } : {}),
  };
};
