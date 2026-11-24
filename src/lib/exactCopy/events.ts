/**
 * 完全模倣(EC-2): 手本の編集を「出来事の一覧」として読み取る。
 * テロップが出た・強調した・寄った・切り替わった・効果音が鳴った・オブジェクトが出た、を手本の最初から最後まで1つずつ拾い、
 * それぞれ「どんな言葉を言った時か」と「どんな見た目・動き・強さ・音か」を書き出す。参考にするのは手本動画1本だけ。
 * 画面の切り替わり(カット・寄り)の時刻はツールが画面から測り、AIに渡して取りこぼしを防ぐ。
 */
import { Type, type Part, type Schema } from "@google/genai";
import { RenderInternals } from "@remotion/renderer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { STEP_MODEL, askJson, geminiClient, referenceMedia } from "./ai";
import type { StyleReferenceFile } from "./ai";

/** 読み取り方を変えたら上げる(前の読み取り結果を使わないように)。 */
const EVENTS_VERSION = 1;
const CACHE_DIR = path.join(os.tmpdir(), "sns-exact-copy-events");
/** AIに見せる手本の細かさ(1秒あたりの枚数)。テロップの出方・寄りの動きを見分けるため、ふつう(1枚)より細かくする。 */
const VIDEO_FPS = 4;
const READ_TIMEOUT_MS = 10 * 60 * 1000;

const callFf = (bin: "ffmpeg" | "ffprobe", args: string[]) =>
  RenderInternals.callFf({
    bin,
    args,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  });

// ---------- 画面の切り替わりを測る ----------

const MEASURE_FPS = 10;
const MEASURE_W = 72;
const MEASURE_H = 128;
/** 人の映っている所(縦15〜55%)の明るさが、1枚の間にこれ以上変わったら切り替わりとみなす(0〜255の平均)。 */
const CHANGE_THRESHOLD = 18;

/** 小さい白黒の画素の並び(1枚ずつ)から、画面が大きく切り替わった秒を出す。0.3秒以内の続きは1回とする。 */
export const changeTimes = (frames: Uint8Array[], width = MEASURE_W, height = MEASURE_H, fps = MEASURE_FPS): number[] => {
  const result: number[] = [];
  const y0 = Math.floor(height * 0.15);
  const y1 = Math.floor(height * 0.55);
  for (let i = 1; i < frames.length; i++) {
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        sum += Math.abs(frames[i][y * width + x] - frames[i - 1][y * width + x]);
        n++;
      }
    }
    const seconds = Math.round((i / fps) * 10) / 10;
    if (sum / n > CHANGE_THRESHOLD && (result.length === 0 || seconds - result[result.length - 1] > 0.3)) result.push(seconds);
  }
  return result;
};

/** 手本の動画の、画面が大きく切り替わった秒(カット・ぱっと寄る・引く)。 */
export const measureChanges = async (absolutePath: string): Promise<number[]> => {
  const result = await callFf("ffmpeg", [
    "-v", "error", "-i", absolutePath, "-r", String(MEASURE_FPS), "-vf", `scale=${MEASURE_W}:${MEASURE_H}`,
    "-pix_fmt", "gray", "-c:v", "rawvideo", "-f", "image2pipe", "-",
  ]);
  const buffer = Buffer.from(result.stdout as unknown as Uint8Array);
  const size = MEASURE_W * MEASURE_H;
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset + size <= buffer.length; offset += size) frames.push(buffer.subarray(offset, offset + size));
  return changeTimes(frames);
};

// ---------- 出来事の一覧をAIに読んでもらう ----------

export const EVENT_KINDS = ["caption", "emphasis", "zoom-in", "zoom-out", "cut", "sfx", "object-in", "object-out", "title"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type ReferenceEvent = {
  seconds: number;
  kind: EventKind;
  /** その時に話していた言葉(聞こえたまま)。 */
  spoken: string;
  /** どんな瞬間か(項目名を言った時・答えを言い切った時・強い言葉・話題が変わった時・話の区切り等)。 */
  trigger: string;
  /** テロップ・タイトル・オブジェクトの文字(写っているまま)。無ければ空。 */
  text: string;
  /** 見た目(書体の感じ・字の色・縁・帯・大きさ・位置)。無ければ空。 */
  look: string;
  /** 出る時の動き・消える時の動き(ぱっと出る・下から・拡大しながら・横から・ふわっと 等)。無ければ空。 */
  motion: string;
  /** 寄りの強さ(1.0=寄っていない。1.2なら1.2倍)。寄り以外は null。 */
  scale: number | null;
  /** 効果音の感じ(短い高い音・重い音・ジャーン 等)。効果音以外は空。 */
  sound: string;
};

export type ReferenceEvents = {
  /** 手本の長さ(秒)。 */
  seconds: number;
  /** ツールが画面から測った切り替わりの秒。 */
  measuredChanges: number[];
  events: ReferenceEvent[];
  /** 手本全体を通した決まり(どんな言葉を強調するか・字幕の作り方・寄り・効果音・オブジェクトの出し方)。 */
  rules: { emphasis: string; captions: string; zoom: string; sfx: string; objects: string };
};

export const EVENTS_PROMPT = (measured: number[], seconds: number) => `
上は、お客様が「この動画をそっくり真似したい」と選んだ手本の動画です(音もあります。1秒に${VIDEO_FPS}枚の細かさで見られます)。長さは${seconds.toFixed(1)}秒です。
このツールは、別の素材動画(同じように人が話している動画)を、この手本と「並べたら同じ編集で、話している中身だけ違う」動画にします。
そのために、手本の編集で起きていることを、最初から最後まで1つ残らず、起きた順に書き出してください。

## 書き出す出来事(kind)
- caption: 話した言葉のふつうの字幕が出た・切り替わった。
- emphasis: ふつうの字幕とは違う、目立つ見た目の字幕(強調)が出た。
- zoom-in / zoom-out: 人物に寄った / 引いた(画面が拡大・縮小した)。
- cut: 映像がつながっていない所(撮った映像の切れ目)。
- sfx: 効果音(話し声・BGM以外の、短い音)が鳴った。
- object-in / object-out: 枠・カード・絵・写真・見出し・丸などの印・最後の案内の文字などが出た / 消えた・動いた。
- title: タイトルが出た・動いた・変わった。

ツールが画面から測った、画面が大きく切り替わった秒は次のとおりです(カット・ぱっと寄る・引く・大きな物が出た、のどれか)。
${measured.length > 0 ? measured.map((t) => `${t.toFixed(1)}秒`).join("・") : "(なし)"}
この秒は必ず見て、何が起きたか(cut・zoom-in・zoom-out・object-in 等)を書いてください。ここに無い所で起きた出来事も、もれなく書いてください。

## 出来事ごとに書くこと
- seconds: 起きた秒(0.1秒単位)。
- kind: 上のどれか。
- spoken: その時に話していた言葉(聞こえたまま。話していなければ空)。
- trigger: どんな瞬間か。例「挙げる物の名前を言った時」「答えを言い切った時」「強い言葉を言った時」「話題が変わった時」「話の区切り」「問いかけた時」「動画の始まり」「動画の終わり」。
- text: 画面に出た文字(写っているまま。無ければ空)。
- look: 見た目。書体の感じ(ゴシック・明朝・丸ゴシック・手書き・ポップ等)、字の色、縁の色と太さ、帯・板の色、大きさ(画面の幅に対して)、位置(画面のどこ)。無ければ空。
- motion: 出る時の動き・消える時の動き(例: ぱっと出る、拡大しながら出る、下から出る、横から流れる、ふわっと出る、揺れる、縮みながら別の所へ動く)。無ければ空。
- scale: zoom-in・zoom-out の時だけ、寄りの強さ(寄っていない時の何倍か。例 1.15)。それ以外は null。
- sound: sfx の時だけ、音の感じ(例: 短く高い音、ポンという軽い音、重い衝撃音、ジャーンという発表の音、シュッという音)。それ以外は空。

## 手本全体の決まり(rules)
- emphasis: どんな言葉・瞬間を強調(目立つ字幕)にしているか。どのくらいの量か(例: 項目の名前は全部、答えは全部、1話題に1回 等)。強調の見た目が何種類かあれば、種類ごとの使い分け。
- captions: ふつうの字幕の作り方(話したまま・縮めている・要点だけ、1回の長さ、切り替わる速さ、話していない時に出しているか)。
- zoom: どんな瞬間に寄り・引いているか、どのくらいの強さか、どのくらいの量か。
- sfx: どんな瞬間に、どんな音を鳴らしているか、どのくらいの量か。
- objects: 枠・カード・絵・見出し・印などを、どんな瞬間に、どう出して・どう消しているか。

## 守ること
- TikTokのロゴ・投稿者名の透かしと、最後に出るTikTokの画面は、保存した時に付いた物なので書かない。
- 見えた物・聞こえた物だけを書く。分からない所は推し量らずに空にする。
`.trim();

const str = { type: Type.STRING };
const EVENTS_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          seconds: { type: Type.NUMBER },
          kind: { type: Type.STRING, format: "enum", enum: [...EVENT_KINDS] },
          spoken: str,
          trigger: str,
          text: str,
          look: str,
          motion: str,
          scale: { type: Type.NUMBER, nullable: true },
          sound: str,
        },
        required: ["seconds", "kind", "spoken", "trigger", "text", "look", "motion", "scale", "sound"],
      },
    },
    rules: {
      type: Type.OBJECT,
      properties: { emphasis: str, captions: str, zoom: str, sfx: str, objects: str },
      required: ["emphasis", "captions", "zoom", "sfx", "objects"],
    },
  },
  required: ["events", "rules"],
};

const EVENTS_PARSE = z.object({
  events: z.array(
    z.object({
      seconds: z.number(),
      kind: z.enum(EVENT_KINDS),
      spoken: z.string().catch(""),
      trigger: z.string().catch(""),
      text: z.string().catch(""),
      look: z.string().catch(""),
      motion: z.string().catch(""),
      scale: z.number().nullable().catch(null),
      sound: z.string().catch(""),
    })
  ),
  rules: z.object({ emphasis: z.string(), captions: z.string(), zoom: z.string(), sfx: z.string(), objects: z.string() }),
});

const durationOf = async (absolutePath: string): Promise<number> => {
  const result = await callFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absolutePath]);
  const seconds = Number(String(result.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const memory = new Map<string, Promise<ReferenceEvents | null>>();

/** 手本(1つ目)の出来事の一覧を読む。同じ手本なら、2回目からは覚えておいた物を使う。読めなかった時は null。 */
export const readReferenceEvents = (file: StyleReferenceFile, referenceId: string): Promise<ReferenceEvents | null> => {
  const key = `e${EVENTS_VERSION}_${referenceId.replace(/[^0-9a-zA-Z_-]/g, "_")}`;
  const running = memory.get(key);
  if (running) return running;
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  const task = (async () => {
    const saved = await readFile(cachePath, "utf8").then((text) => JSON.parse(text) as ReferenceEvents).catch(() => null);
    if (saved) return saved;
    if (file.kind !== "video" || file.youtubeUrl) return null;
    const seconds = await durationOf(file.absolutePath);
    const measuredChanges = await measureChanges(file.absolutePath).catch(() => []);
    const media = await referenceMedia(geminiClient(), [file]);
    // 細かく見られるよう、手本の動画に1秒あたりの枚数を付ける
    const detailed: Part[] = media.map((part) => (part.fileData ? { ...part, videoMetadata: { fps: VIDEO_FPS } } : part));
    const raw = await askJson({
      model: STEP_MODEL,
      label: "手本の出来事の一覧",
      timeoutMs: READ_TIMEOUT_MS,
      parts: [...detailed, { text: EVENTS_PROMPT(measuredChanges, seconds) }],
      schema: EVENTS_SCHEMA,
      parse: EVENTS_PARSE,
    });
    const result: ReferenceEvents = {
      seconds,
      measuredChanges,
      events: raw.events.filter((event) => event.seconds >= 0 && event.seconds <= seconds + 0.5).sort((a, b) => a.seconds - b.seconds),
      rules: raw.rules,
    };
    await mkdir(CACHE_DIR, { recursive: true }).catch(() => undefined);
    await writeFile(cachePath, JSON.stringify(result, null, 2)).catch(() => undefined);
    return result;
  })().catch((error: unknown) => {
    console.warn("[exactCopy] 手本の出来事の一覧を読めませんでした", error);
    memory.delete(key);
    return null;
  });
  memory.set(key, task);
  return task;
};
