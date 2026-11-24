/**
 * 完全模倣(EC)で使う、見た目の手本の型の読み取り。今までの作り方(src/lib/editSteps/templateExtract.ts)の写しから始め、
 * 完全模倣の直しはこちらだけに入れる。読み取った型は、今までの型とは別の所に覚える。
 */
import { Type, type Part, type Schema } from "@google/genai";
import { RenderInternals } from "@remotion/renderer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { CaptionFontFamily } from "@video/shared/schema";
import {
  STEP_MODEL,
  askJson,
  colorParse,
  colorSchema,
  FONT_HINTS,
  FONT_VALUES,
  geminiClient,
  nullableColorParse,
  nullableColorSchema,
  referenceMedia,
  type StyleReferenceFile,
} from "./ai";
import { drawGrid, encodePng } from "@/lib/editSteps/gridImage";
import { bestLook, MIN_MATCH_SCORE } from "./drawMatch";
import { toReferenceLayout } from "@/lib/editSteps/logic";
import type { ReferenceTemplate, TemplateTextLook } from "@/lib/editSteps/template";

/**
 * お客様が添付した見た目の手本(動画・スクリーンショット)から、型(template.ts)を自動で読み取る。
 * 1. 手本から場面をいくつか絵として取り出し、手本の動画と一緒にAIに見せて、何がどこにどう出るかを数字で答えてもらう。
 * 2. 色はAIの答えだけに任せず、その場面の絵から実際の色を測り、AIの答えに一番近い色に合わせる
 *    (以前、タイトルの「白い文字に青い縁取り」が「青い文字に白い縁取り」に入れ替わるなど、色の取り違えがあったため)。
 * 3. 読み取った型は手本ごとに覚えておき、次からは読み取り直さない。
 * 型に入れるのは見た目と「並べ方・出し方の決まり」だけ。数・文言は動画ごとにAIが決める(template.ts参照)。
 */

/** 読み取り方を変えたら上げる(前の読み取り結果を使わないように)。 */
const EXTRACT_VERSION = 10;
const CACHE_DIR = path.join(os.tmpdir(), "sns-exact-copy-templates");
/** 色を測るための絵の大きさ。 */
const SAMPLE_WIDTH = 540;
const SAMPLE_HEIGHT = 960;
/** AIに見せる場面の数(動画の手本)。 */
const STILL_COUNT = 16;
/** 絵をたくさん見せるので、1回の答えを待つ時間を長めにする。 */
const EXTRACT_TIMEOUT_MS = 240_000;

const percent = z.number().transform((value) => Math.min(100, Math.max(0, value)));
const positive = z.number().transform((value) => Math.max(0, value));
const boxParse = z.object({ xPercent: percent, yPercent: percent, widthPercent: percent, heightPercent: percent });
/** 書体の名前を、使える書体の候補に合わせる(答えの形の指定に候補を全部並べると、AIが受け付けないほど大きくなるため、名前で受け取る)。 */
const fontParse = z.string().transform((value): CaptionFontFamily => {
  const normalized = value.trim().toLowerCase();
  const found = FONT_VALUES.find((font) => font.toLowerCase() === normalized) ?? FONT_VALUES.find((font) => normalized.includes(font.toLowerCase()) || font.toLowerCase().includes(normalized));
  return found ?? "Noto Sans JP";
});
const lookParse = z.object({
  fontFamily: fontParse,
  color: colorParse,
  strokeColor: nullableColorParse,
  bandColor: nullableColorParse,
  glowColor: nullableColorParse,
  seconds: positive,
  box: boxParse,
});
type RawLook = z.infer<typeof lookParse>;

const num = { type: Type.NUMBER };
const str = { type: Type.STRING };
const obj = (properties: Record<string, Schema>, nullable = false): Schema => ({
  type: Type.OBJECT,
  ...(nullable ? { nullable: true } : {}),
  properties,
  required: Object.keys(properties),
});
const boxSchema = obj({ xPercent: num, yPercent: num, widthPercent: num, heightPercent: num });
const lookSchema = obj({
  fontFamily: str,
  color: colorSchema,
  strokeColor: nullableColorSchema,
  bandColor: nullableColorSchema,
  glowColor: nullableColorSchema,
  seconds: num,
  box: boxSchema,
});

export const TEMPLATE_EXTRACT_PROMPT = (stillTimes: number[]) => `
上は、お客様が「この見た目にしたい」と選んだ見た目の手本です${stillTimes.length > 0 ? `(動画と、そこから取り出した場面の絵。絵の秒数: ${stillTimes.map((t) => `${t.toFixed(1)}秒`).join("・")})` : ""}。
場面の絵には、位置を読むための目盛りを描いてあります(赤紫の線。濃い線と数字が10%ごと、薄い線が5%ごと。左上が0)。位置・大きさは、この目盛りで測って答えてください(目盛りは手本の一部ではありません)。
このツールは、別の素材動画(人が話している動画)を、この手本と「並べたら同じ作りで、話している中身だけ違う」動画に編集します。
そのために、手本の見た目と、並べ方・出し方の決まりを、数字で細かく読み取ってください。

## 手本から読み取るもの(見た目と決まり)
- 人物の顔の位置と大きさ。字幕・タイトル・枠・カード・見出し・最後の一言の位置・大きさ・書体・色・縁取り・帯・光。
- ランキングの枠・比べるカードの形、並べ方(どの範囲に、どう並ぶか)、番号の書き方と順位ごとの色。
- 項目の出し方(言った時に、まず大きく出してから枠へ入るか等)、枠・カードの中身が絵・写真か文字か。
- 強調した字幕の見た目。手本に何種類かあれば、種類ごとに、どんな字幕に使っているか(役割)。
- 選ばれた方に丸などの印を付けているか、その見た目。最後の一言(予約への案内など)があるか、その見た目と出ている秒数。
- タイトルの言い回しの形。手本の文言そのものではなく、形だけを書く(例「1行目に問いかけ、2行目に答えの予告」「1行目に数、2行目に〇〇の方法」)。

## 読み取らないもの(動画ごとに変わるので、型に入れない)
- 手本に写っている文言・題材・人の名前・項目の名前・数字。項目・カード・見出しの数。
- TikTokなどのロゴ・投稿者名の透かしと、最後に出るTikTokの画面(保存した時に付いた物なので、まねしない)。

## 答え方
- 位置・大きさは、縦長の画面の幅・高さに対する%(0〜100。左上が0)。箱は中心の位置(xPercent・yPercent)と幅・高さ。
- 文字の大きさは charHeightPercent(1文字の高さ。画面の高さに対する%)で答える。
- 文字の見た目(look)は、fontFamily(書体)・color(文字の色)・strokeColor(縁取りの色。無ければnull)・bandColor(文字の後ろの帯・板の色。無ければnull)・
  glowColor(文字の周りの光・にじみの色。無ければnull)。あわせて、その見た目がはっきり見える場面の秒数(seconds)と、その文字の箱(box)を答える(ツールがその場面の色を測って確かめる)。
- 色は #RRGGBB。文字の色と縁取りの色を取り違えない。color は字の線の内側(真ん中)の色、strokeColor はその外側を囲む縁の色。
  例: 黄色い字を黒い太い縁が囲んでいれば color=黄・strokeColor=黒。黒い字を白い縁が囲んでいれば color=黒・strokeColor=白。よく見て区別する。
- 書体は次から一番近い物: ${FONT_HINTS}
  明朝体(Noto Serif JP など)は、縦の線が太く横の線が細く、線の終わりに「うろこ」(三角の飾り)がある。ゴシック体は線の太さが一定。丸ゴシック(M PLUS Rounded 1c)は線の端が丸い。
  飾りや崩しの無い、ふつうの太いゴシックは Noto Sans JP(標準ゴシック)。ポップな書体(Mochiy Pop One・Reggae One・Potta One・Dela Gothic One など)は、
  字の形が丸く崩してある・極端に太い・飾りがある、とはっきり分かる時だけ選ぶ(太い縁取りが付いているだけなら、ふつうのゴシック)。
  ふつうの字幕・タイトル・強調した字幕・枠の文字で、書体が違うことがよくあるので、それぞれ別に見分ける。
- 枠・カードの中が透けて、後ろの人や部屋が見えるなら fillColor は null(塗りつぶしにしない)。
- 文字の大きさ(charHeightPercent)は、漢字1文字の上の端から下の端までの高さを、目盛りで測る(縁取りは含めない)。
- 手本に無い物は null。

## 項目
- kind: ranking=番号付きの枠を縦に並べて項目を順に入れる / compare=カードを横に並べて比べる / none=どちらでもない。
- face: 話している人の顔(中心と、髪の生え際からあごまでの高さ)。
- caption: 話した言葉のふつうの字幕。動画の中で一番多く・長く出ている字幕の見た目がふつうの字幕(場面の絵を全部見比べて決める)。
  それより少ない回数だけ出る、目立つ見た目の字幕は emphasisStyles に入れる。caption の look.seconds には、ふつうの字幕が出ている場面の秒数を答える。
  topPercent=1行目の上端、xPercent=字幕の横の中心、maxWidthPercent=字幕1行の幅の上限、charHeightPercent、
  style(outline=縁取り文字 / pill=色の帯の上の文字)、look、lines(よく出る行数。1か2)。
- emphasisStyles: 強調した字幕(ふつうの字幕より目立つ見た目の字幕)。種類ごとに、role(どんな字幕に使っているか。例「数字・金額」「話の要点・強い言葉」「問いかけ」)、
  look、scale(ふつうの字幕に対する文字の大きさの倍)。よく使う物から順に。強調が無ければ空。
- title: 動画のあいだずっと出ているタイトル。align、xPercent(中央寄せなら中心・左寄せなら左端)、yPercent(全体の縦の中心)、charHeightPercent、maxWidthPercent(1行の幅)、
  lines(行ごとの look。行の数=タイトルの行数)、wording(言い回しの形)、band(タイトルの後ろの、画面の端から端までの帯。color・topPercent・heightPercent。無ければnull)、
  intro(冒頭に、別の所に大きく出してから、いつもの所へ動くなら、その秒数と、大きく出した時の中心と文字の高さ。無ければnull)。
- frames(kind=rankingの時): 枠を並べる範囲(xPercent・widthPercent・topPercent=1つ目の上端・bottomPercent=最後の下端・gapPercent=枠の間)、count(手本の枠の数)、
  枠の形(borderColor・borderWidthPx(横1080pxでの太さ)・fillColor・cornerRadiusPx)、numberFormat(番号の書き方。数字を{n}に。例「{n}位」)、numberCharHeightPercent、
  numberLooks(上の順位から順に、番号の見た目。順位で色が違えば順位ごとに。4位以降が同じなら4つ目まででよい)、numberPosition(枠の中のどこに番号があるか)、
  content(枠の中身: image=絵・写真 / text=文字)、label(content=textの時の文字。look と charHeightPercent)、
  popup(項目を言った時に、まず別の所に大きく出してから枠へ入るなら、その箱と秒数と、一緒に出る名前の文字(look・charHeightPercent・yPercent)。無ければnull)。
- compare(kind=compareの時): カードを並べる範囲(yPercent=カードの縦の中心・heightPercent・leftPercent=左端のカードの左端・rightPercent=右端のカードの右端・gapPercent=カードの間)、
  カードの形(borderColor・borderWidthPx・fillColor・cornerRadiusPx)、content(カードの中身: image=比べる物の絵 / text=話題ごとに変わる文字 / none=名前だけ)、
  name(比べる物の名前の文字。look・charHeightPercent・fromBottomPercent=カードの下端から名前の文字の中心までの高さ)、contentText(content=textの時。無ければnull)、
  topic(カードの上に出る「今の話題」の見出し。xPercent・yPercent・charHeightPercent・look。無ければnull)、
  marker(選ばれた方のカードに付ける丸などの印。color・strokeWidthPx(線の太さ)・when(どんな時に付けているか)。無ければnull)。
- cta: 最後の一言(予約への案内など)。xPercent・yPercent・charHeightPercent・maxWidthPercent・look・seconds(動画の終わりの何秒前から出ているか)。無ければnull。
- note: 読み取りで迷った所(1〜3文)。
`.trim();

const textBlock = (extra: Record<string, Schema> = {}) => obj({ look: lookSchema, charHeightPercent: num, ...extra });

export const RESPONSE_SCHEMA: Schema = obj({
  kind: { type: Type.STRING, format: "enum", enum: ["ranking", "compare", "none"] },
  face: obj({ xPercent: num, yPercent: num, heightPercent: num }, true),
  caption: obj({
    topPercent: num,
    xPercent: num,
    maxWidthPercent: num,
    charHeightPercent: num,
    style: { type: Type.STRING, format: "enum", enum: ["outline", "pill"] },
    look: lookSchema,
    lines: num,
  }),
  emphasisStyles: { type: Type.ARRAY, items: obj({ role: str, look: lookSchema, scale: num }) },
  title: obj({
    align: { type: Type.STRING, format: "enum", enum: ["left", "center"] },
    xPercent: num,
    yPercent: num,
    charHeightPercent: num,
    maxWidthPercent: num,
    lines: { type: Type.ARRAY, items: lookSchema },
    wording: str,
    band: obj({ color: colorSchema, topPercent: num, heightPercent: num }, true),
    intro: obj({ seconds: num, xPercent: num, yPercent: num, charHeightPercent: num }, true),
  }),
  frames: obj(
    {
      xPercent: num,
      widthPercent: num,
      topPercent: num,
      bottomPercent: num,
      gapPercent: num,
      count: num,
      borderColor: nullableColorSchema,
      borderWidthPx: num,
      fillColor: nullableColorSchema,
      cornerRadiusPx: num,
      numberFormat: str,
      numberCharHeightPercent: num,
      numberLooks: { type: Type.ARRAY, items: lookSchema },
      numberPosition: { type: Type.STRING, format: "enum", enum: ["bottom-left", "top-left", "left", "center"] },
      content: { type: Type.STRING, format: "enum", enum: ["image", "text"] },
      label: textBlock(),
      popup: obj({ xPercent: num, yPercent: num, widthPercent: num, heightPercent: num, seconds: num, name: textBlock({ yPercent: num }) }, true),
    },
    true
  ),
  compare: obj(
    {
      yPercent: num,
      heightPercent: num,
      leftPercent: num,
      rightPercent: num,
      gapPercent: num,
      borderColor: nullableColorSchema,
      borderWidthPx: num,
      fillColor: nullableColorSchema,
      cornerRadiusPx: num,
      content: { type: Type.STRING, format: "enum", enum: ["image", "text", "none"] },
      name: textBlock({ fromBottomPercent: num }),
      contentText: { ...textBlock(), nullable: true },
      topic: obj({ xPercent: num, yPercent: num, charHeightPercent: num, look: lookSchema }, true),
      marker: obj({ color: colorSchema, strokeWidthPx: num, when: str }, true),
    },
    true
  ),
  cta: obj({ xPercent: num, yPercent: num, charHeightPercent: num, maxWidthPercent: num, look: lookSchema, seconds: num }, true),
  note: str,
});

const textBlockParse = z.object({ look: lookParse, charHeightPercent: percent });
const RESPONSE_PARSE = z.object({
  kind: z.enum(["ranking", "compare", "none"]),
  face: z.object({ xPercent: percent, yPercent: percent, heightPercent: percent }).nullable().default(null),
  caption: z.object({
    topPercent: percent,
    xPercent: percent,
    maxWidthPercent: percent,
    charHeightPercent: percent,
    style: z.enum(["outline", "pill"]),
    look: lookParse,
    lines: z.number().default(1),
  }),
  emphasisStyles: z.array(z.object({ role: z.string(), look: lookParse, scale: z.number().default(1) })).default([]),
  title: z.object({
    align: z.enum(["left", "center"]),
    xPercent: percent,
    yPercent: percent,
    charHeightPercent: percent,
    maxWidthPercent: percent,
    lines: z.array(lookParse).min(1),
    wording: z.string().default(""),
    band: z.object({ color: colorParse, topPercent: percent, heightPercent: percent }).nullable().default(null),
    intro: z.object({ seconds: positive, xPercent: percent, yPercent: percent, charHeightPercent: percent }).nullable().default(null),
  }),
  frames: z
    .object({
      xPercent: percent,
      widthPercent: percent,
      topPercent: percent,
      bottomPercent: percent,
      gapPercent: percent,
      count: z.number(),
      borderColor: nullableColorParse,
      borderWidthPx: positive,
      fillColor: nullableColorParse,
      cornerRadiusPx: positive,
      numberFormat: z.string(),
      numberCharHeightPercent: percent,
      numberLooks: z.array(lookParse).min(1),
      numberPosition: z.enum(["bottom-left", "top-left", "left", "center"]).default("bottom-left"),
      content: z.enum(["image", "text"]),
      label: textBlockParse,
      popup: z
        .object({
          xPercent: percent,
          yPercent: percent,
          widthPercent: percent,
          heightPercent: percent,
          seconds: positive,
          name: textBlockParse.extend({ yPercent: percent }),
        })
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  compare: z
    .object({
      yPercent: percent,
      heightPercent: percent,
      leftPercent: percent,
      rightPercent: percent,
      gapPercent: percent,
      borderColor: nullableColorParse,
      borderWidthPx: positive,
      fillColor: nullableColorParse,
      cornerRadiusPx: positive,
      content: z.enum(["image", "text", "none"]),
      name: textBlockParse.extend({ fromBottomPercent: percent }),
      contentText: textBlockParse.nullable().default(null),
      topic: z.object({ xPercent: percent, yPercent: percent, charHeightPercent: percent, look: lookParse }).nullable().default(null),
      marker: z.object({ color: colorParse, strokeWidthPx: positive, when: z.string() }).nullable().default(null),
    })
    .nullable()
    .default(null),
  cta: z
    .object({ xPercent: percent, yPercent: percent, charHeightPercent: percent, maxWidthPercent: percent, look: lookParse, seconds: positive })
    .nullable()
    .default(null),
  note: z.string().default(""),
});
export type ExtractedTemplate = z.infer<typeof RESPONSE_PARSE>;

// ---------- 場面の絵 ----------

const callFf = (bin: "ffmpeg" | "ffprobe", args: string[]) =>
  RenderInternals.callFf({
    bin,
    args,
    indent: false,
    logLevel: "error",
    binariesDirectory: null,
    cancelSignal: undefined,
    options: { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  });

const durationOf = async (absolutePath: string): Promise<number> => {
  const result = await callFf("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absolutePath]);
  const seconds = Number(String(result.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

/** 指定した秒の場面の生の画素(RGB。静止画の手本は seconds を使わない)。 */
const rgbFrameAt = async (file: StyleReferenceFile, seconds: number, width: number, height: number): Promise<Buffer> => {
  const seek = file.kind === "video" ? ["-ss", String(seconds)] : [];
  const result = await callFf("ffmpeg", [
    "-v", "error", ...seek, "-i", file.absolutePath, "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2pipe", "-",
  ]);
  return Buffer.from(result.stdout as unknown as Uint8Array);
};

/** AIに見せる場面の絵(位置を読むための目盛り付きのPNG)。 */
const STILL_WIDTH = 540;
const STILL_HEIGHT = 960;
const stillAt = async (file: StyleReferenceFile, seconds: number): Promise<Buffer | null> => {
  const pixels = await rgbFrameAt(file, seconds, STILL_WIDTH, STILL_HEIGHT);
  if (pixels.length < STILL_WIDTH * STILL_HEIGHT * 3) return null;
  return encodePng(drawGrid(pixels, STILL_WIDTH, STILL_HEIGHT), STILL_WIDTH, STILL_HEIGHT);
};

/** AIに見せる場面の秒数(冒頭は細かく、あとは等間隔。最後のTikTokの画面は避ける)。 */
const stillTimesOf = (duration: number): number[] => {
  if (duration <= 0) return [];
  const end = Math.max(1, duration - 3);
  const times = [0.5, 2.5, ...Array.from({ length: STILL_COUNT - 2 }, (_, i) => (end * (i + 1)) / (STILL_COUNT - 1))];
  return [...new Set(times.map((t) => Math.round(Math.min(end, t) * 10) / 10))];
};

// ---------- 顔の位置と大きさを測る(EC-7) ----------

export const FACE_MEASURE_PROMPT = (times: number[]) => `
上は、話している人が映っている動画の、${times.map((t) => `${t.toFixed(1)}秒`).join("・")}の場面の絵です。赤紫の線は位置を読むための目盛りです(濃い線と数字が10%ごと、薄い線が5%ごと。左上が0)。
絵ごとに、話している人の顔の箱を、目盛りで測って答えてください。
- xPercent・yPercent: 顔の中心(画面の幅・高さに対する%)。
- heightPercent: 顔の高さ(髪の生え際から、あごの先まで。画面の高さに対する%)。
- 顔が映っていない絵は found=false。
`.trim();

/**
 * 動画の顔の位置と大きさを、目盛り付きの場面の絵5枚で測り、真ん中の値を返す(EC-7)。
 * 手本とカット動画を同じ測り方で測り、先生の映り方(拡大と位置)を手本にそろえる(測り方が違うと、ずれ方も違って合わなかった)。
 */
export const measureFace = async (file: StyleReferenceFile): Promise<{ xPercent: number; yPercent: number; heightPercent: number } | null> => {
  const duration = file.kind === "video" && !file.youtubeUrl ? await durationOf(file.absolutePath).catch(() => 0) : 0;
  if (duration <= 0) return null;
  const times = [0.2, 0.35, 0.5, 0.65, 0.8].map((r) => Math.round(Math.max(0.5, Math.min(duration - 3, duration * r)) * 10) / 10);
  const parts: Part[] = [];
  for (const seconds of times) {
    const png = await stillAt(file, seconds).catch(() => null);
    if (png) parts.push({ text: `【${seconds.toFixed(1)}秒の場面】` }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
  }
  if (parts.length === 0) return null;
  const answer = await askJson({
    model: STEP_MODEL,
    label: "顔の位置と大きさ",
    parts: [...parts, { text: FACE_MEASURE_PROMPT(times) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        faces: { type: Type.ARRAY, items: obj({ found: { type: Type.BOOLEAN }, xPercent: num, yPercent: num, heightPercent: num }) },
      },
      required: ["faces"],
    },
    parse: z.object({ faces: z.array(z.object({ found: z.boolean(), xPercent: z.number(), yPercent: z.number(), heightPercent: z.number() })) }),
  }).catch(() => null);
  const found = (answer?.faces ?? []).filter((face) => face.found && face.heightPercent > 2 && face.heightPercent < 80);
  if (found.length === 0) return null;
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return {
    xPercent: median(found.map((face) => face.xPercent)),
    yPercent: median(found.map((face) => face.yPercent)),
    heightPercent: median(found.map((face) => face.heightPercent)),
  };
};

// ---------- 色を測る ----------

type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const rgbToHex = (rgb: Rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 箱の中で多い色(似た色をまとめて、多い順。全体の3%未満の色は除く)。 */
export const dominantColors = (pixels: Uint8Array, width: number, height: number, box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }): Rgb[] => {
  const x0 = Math.max(0, Math.floor(((box.xPercent - box.widthPercent / 2) / 100) * width));
  const x1 = Math.min(width, Math.ceil(((box.xPercent + box.widthPercent / 2) / 100) * width));
  const y0 = Math.max(0, Math.floor(((box.yPercent - box.heightPercent / 2) / 100) * height));
  const y1 = Math.min(height, Math.ceil(((box.yPercent + box.heightPercent / 2) / 100) * height));
  const buckets = new Map<string, { sum: Rgb; count: number }>();
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 3;
      const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const key = rgb.map((v) => Math.round(v / 32)).join(",");
      const bucket = buckets.get(key) ?? { sum: [0, 0, 0], count: 0 };
      bucket.sum = [bucket.sum[0] + rgb[0], bucket.sum[1] + rgb[1], bucket.sum[2] + rgb[2]];
      bucket.count++;
      buckets.set(key, bucket);
      total++;
    }
  }
  if (total === 0) return [];
  return [...buckets.values()]
    .filter((bucket) => bucket.count / total >= 0.03)
    .sort((a, b) => b.count - a.count)
    .map((bucket) => bucket.sum.map((v) => v / bucket.count) as Rgb);
};

/** AIの答えた色を、その所で実際に多い色のうち一番近い物に合わせる(近い色が無ければAIの答えのまま)。 */
export const snapColor = (guess: string, measured: Rgb[], exclude: Rgb[] = []): string => {
  const target = hexToRgb(guess);
  const candidates = measured.filter((rgb) => exclude.every((other) => distance(rgb, other) > 40));
  const best = candidates.reduce<{ rgb: Rgb; d: number } | null>((acc, rgb) => {
    const d = distance(rgb, target);
    return !acc || d < acc.d ? { rgb, d } : acc;
  }, null);
  return best && best.d <= 110 ? rgbToHex(best.rgb) : guess.toUpperCase();
};

/**
 * 縁取り文字の「文字の色」と「縁取りの色」が入れ替わっていないかを、画素の並びで確かめる。
 * 本当の文字の色の画素からは、上下左右どちらへ進んでも、背景より先に縁取りの色に当たる(縁取りが文字を囲んでいるため)。
 * 縁取りの色の画素は、外へ進むと背景に当たる。囲まれている割合を比べて、縁取りの方が囲まれていれば入れ替える。
 * 戻り値: 入れ替えるべきなら true(どちらとも言えなければ false)。
 */
export const strokeLooksSwapped = (
  pixels: Uint8Array,
  width: number,
  height: number,
  box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  fill: string,
  stroke: string
): boolean => {
  const fillRgb = hexToRgb(fill);
  const strokeRgb = hexToRgb(stroke);
  if (distance(fillRgb, strokeRgb) < 60) return false;
  const x0 = Math.max(0, Math.floor(((box.xPercent - box.widthPercent / 2) / 100) * width));
  const x1 = Math.min(width, Math.ceil(((box.xPercent + box.widthPercent / 2) / 100) * width));
  const y0 = Math.max(0, Math.floor(((box.yPercent - box.heightPercent / 2) / 100) * height));
  const y1 = Math.min(height, Math.ceil(((box.yPercent + box.heightPercent / 2) / 100) * height));
  const classOf = (x: number, y: number): 0 | 1 | 2 => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const i = (y * width + x) * 3;
    const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const df = distance(rgb, fillRgb);
    const ds = distance(rgb, strokeRgb);
    if (Math.min(df, ds) > 50) return 0;
    return df <= ds ? 1 : 2;
  };
  const REACH = 20;
  /**
   * その画素から4方向へ進んで、背景より先に相手の色に当たる方向が3つ以上あるか。
   * 2色の境目には混ざった色の画素があるので、どちらでもない画素は2つまで飛ばす。
   */
  const enclosed = (x: number, y: number, self: 1 | 2): boolean => {
    const other = self === 1 ? 2 : 1;
    let hits = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let unknown = 0;
      for (let d = 1; d <= REACH; d++) {
        const c = classOf(x + dx * d, y + dy * d);
        if (c === self) {
          unknown = 0;
          continue;
        }
        if (c === other) {
          hits++;
          break;
        }
        if (++unknown > 2) break;
      }
    }
    return hits >= 3;
  };
  const counts = [0, 0, 0];
  const inside = [0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const c = classOf(x, y);
      if (c === 0) continue;
      counts[c]++;
      if (enclosed(x, y, c)) inside[c]++;
    }
  }
  if (counts[1] < 30 || counts[2] < 30) return false;
  const fillInside = inside[1] / counts[1];
  const strokeInside = inside[2] / counts[2];
  if (strokeInside >= 0.25 && strokeInside > fillInside * 2) return true;
  if (fillInside >= 0.25 && fillInside > strokeInside * 2) return false;
  // どちらも相手に囲まれている(縁の外側にさらに文字の色と同じ細い縁がある等)時は、外側から見て決める
  return outerLayerSays(classOf, x0, x1, y0, y1) === "fill-is-stroke";
};

/**
 * 箱の各行・各列を、両端から内側へたどり、背景の次に出てくる色の並びで、どちらが縁かを多数決する。
 * ふつうは、背景のすぐ内側が縁の色。ただし、すぐ内側の色が細く、次の色が太く、その先にまた最初の色が出てくるなら、
 * 最初の色は外側の細い縁(文字と同じ色)で、次の色が縁。
 */
const outerLayerSays = (classOf: (x: number, y: number) => 0 | 1 | 2, x0: number, x1: number, y0: number, y1: number): "fill-is-stroke" | "as-is" | null => {
  const votes = [0, 0, 0];
  const scan = (points: [number, number][]) => {
    const runs: { c: 1 | 2; length: number }[] = [];
    let unknown = 0;
    let started = false;
    for (const [x, y] of points) {
      const c = classOf(x, y);
      if (c === 0) {
        if (started && ++unknown > 2) break;
        continue;
      }
      started = true;
      unknown = 0;
      const last = runs[runs.length - 1];
      if (last && last.c === c) last.length++;
      else runs.push({ c, length: 1 });
      if (runs.length >= 3) break;
    }
    if (runs.length < 2) return;
    const [first, second, third] = runs;
    const thinOuter = third && third.c === first.c && first.length * 2 <= second.length;
    votes[thinOuter ? second.c : first.c]++;
  };
  for (let y = y0; y < y1; y++) {
    const row: [number, number][] = [];
    for (let x = x0; x < x1; x++) row.push([x, y]);
    scan(row);
    scan([...row].reverse());
  }
  for (let x = x0; x < x1; x++) {
    const column: [number, number][] = [];
    for (let y = y0; y < y1; y++) column.push([x, y]);
    scan(column);
    scan([...column].reverse());
  }
  if (votes[1] + votes[2] < 10) return null;
  // 縁の色に多く票が入る。AIの答えた「文字の色」に多く入っていれば、入れ替わっている
  if (votes[1] > votes[2] * 1.5) return "fill-is-stroke";
  if (votes[2] > votes[1] * 1.5) return "as-is";
  return null;
};

const FULL_BOX = { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 };

/**
 * 箱の中で「文字の色の画素で、2画素以内に縁取り(か帯)の色がある物」が、箱の広さの何割あるか。
 * その見た目の文字がどれだけ写っているかの目安(背景にたまたま同じ色があっても、2色が隣り合っていなければ数えない)。
 */
export const edgePairScore = (
  pixels: Uint8Array,
  width: number,
  height: number,
  box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  fill: string,
  edge: string,
  tolerance = 60
): number => {
  const fillRgb = hexToRgb(fill);
  const edgeRgb = hexToRgb(edge);
  if (distance(fillRgb, edgeRgb) < 60) return 0;
  const x0 = Math.max(0, Math.floor(((box.xPercent - box.widthPercent / 2) / 100) * width));
  const x1 = Math.min(width, Math.ceil(((box.xPercent + box.widthPercent / 2) / 100) * width));
  const y0 = Math.max(0, Math.floor(((box.yPercent - box.heightPercent / 2) / 100) * height));
  const y1 = Math.min(height, Math.ceil(((box.yPercent + box.heightPercent / 2) / 100) * height));
  if (x1 <= x0 || y1 <= y0) return 0;
  const near = (x: number, y: number, target: Rgb) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 3;
    return distance([pixels[i], pixels[i + 1], pixels[i + 2]], target) <= tolerance;
  };
  let hits = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!near(x, y, fillRgb)) continue;
      let found = false;
      for (let d = 1; d <= 2 && !found; d++) {
        found = near(x + d, y, edgeRgb) || near(x - d, y, edgeRgb) || near(x, y + d, edgeRgb) || near(x, y - d, edgeRgb);
      }
      if (found) hits++;
    }
  }
  return hits / ((x1 - x0) * (y1 - y0));
};

/**
 * AIの答えた文字の箱が上下にずれていたら、文字のある所に合わせる(上下に4%まで動かして、文字の色と縁の色が一番多く並ぶ所)。
 * 箱がずれると、背景の色を測ってしまい、文字の色や縁の色を取り違えたため。
 */
export const alignBox = (
  pixels: Uint8Array,
  width: number,
  height: number,
  box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  fill: string,
  edge: string | null
) => {
  if (!edge) return box;
  const scoreAt = (dy: number) => edgePairScore(pixels, width, height, { ...box, yPercent: box.yPercent + dy }, fill, edge, 80);
  const current = scoreAt(0);
  let best = { dy: 0, score: current };
  for (let dy = -4; dy <= 4; dy += 0.5) {
    const score = scoreAt(dy);
    if (score > best.score) best = { dy, score };
  }
  // はっきり良くなる時だけ動かす
  return best.score > current * 1.3 && best.score > 0.01 ? { ...box, yPercent: box.yPercent + best.dy } : box;
};

/**
 * カードの下半分で、名前の文字の色の画素がある行の固まりのうち、一番下の物の縦の中心(画面の高さに対する%)。
 * カードの縁の線を数えないように、左右の端の1割と、下の端の3%は見ない。見つからなければ null。
 */
export const measureNameCenter = (
  pixels: Uint8Array,
  width: number,
  height: number,
  card: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  color: string
): number | null => {
  const target = hexToRgb(color);
  const x0 = Math.max(0, Math.floor(((card.xPercent - card.widthPercent * 0.4) / 100) * width));
  const x1 = Math.min(width, Math.ceil(((card.xPercent + card.widthPercent * 0.4) / 100) * width));
  const bottom = Math.min(height - 1, Math.floor(((card.yPercent + card.heightPercent / 2 - 3 * (card.heightPercent / 100)) / 100) * height));
  const middle = Math.max(0, Math.floor((card.yPercent / 100) * height));
  const minInk = Math.max(2, Math.round((x1 - x0) * 0.02));
  const inkRow = (y: number) => {
    let count = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 3;
      if (distance([pixels[i], pixels[i + 1], pixels[i + 2]], target) <= 60) count++;
    }
    return count >= minInk && count < (x1 - x0) * 0.8;
  };
  let end = -1;
  let start = -1;
  for (let y = bottom; y >= middle; y--) {
    if (inkRow(y)) {
      if (end < 0) end = y;
      start = y;
    } else if (end >= 0 && start - y > 2) {
      break;
    }
  }
  if (end < 0 || end - start < 2) return null;
  return (((start + end) / 2 + 0.5) / height) * 100;
};

// ---------- 型にする ----------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** 1文字の高さ(%)から、文字の大きさ(px)。 */
const fontPx = (charHeightPercent: number, min = 24, max = 200) => Math.round(clamp((charHeightPercent / 100) * 1920, min, max));

const toLook = (raw: RawLook): TemplateTextLook => ({
  fontFamily: raw.fontFamily as CaptionFontFamily,
  color: raw.color.toUpperCase(),
  ...(raw.strokeColor ? { strokeColor: raw.strokeColor.toUpperCase() } : {}),
  ...(raw.bandColor ? { bandColor: raw.bandColor.toUpperCase() } : {}),
  ...(raw.glowColor ? { glowColor: raw.glowColor.toUpperCase() } : {}),
});

/** 読み取った答えを、型の形にする(数字を使える範囲に収める)。 */
export const toReferenceTemplate = (raw: ExtractedTemplate, meta: { name: string; referenceIds: string[] }): ReferenceTemplate => {
  const captionSize = toReferenceLayout({ face: null, caption: { topPercent: raw.caption.topPercent, charHeightPercent: raw.caption.charHeightPercent }, title: null, frames: null }).caption?.fontSize ?? "large";
  const captionLook = toLook(raw.caption.look);
  const lineHeight = raw.caption.charHeightPercent * 1.3;
  // 字幕の下に見出し・カードがある時は、字幕の下の端を固定して、2行になったら上へ伸ばす(下の物に重ならないように)
  const objectBelow = raw.compare ? Math.min(raw.compare.yPercent - raw.compare.heightPercent / 2, raw.compare.topic ? raw.compare.topic.yPercent - raw.compare.topic.charHeightPercent : 100) : 100;
  const captionBottom = raw.caption.topPercent + lineHeight * Math.max(1, Math.round(raw.caption.lines));
  const kind = raw.kind === "ranking" && !raw.frames ? "none" : raw.kind === "compare" && !raw.compare ? "none" : raw.kind;
  const titleFont = fontPx(raw.title.charHeightPercent, 28, 120);
  const emphasisStyles = raw.emphasisStyles.map((style) => ({
    role: style.role.trim() || "話の要点",
    fontFamily: style.look.fontFamily as CaptionFontFamily,
    textColor: style.look.color.toUpperCase(),
    bandColor: style.look.bandColor ? style.look.bandColor.toUpperCase() : null,
    ...(style.look.strokeColor ? { strokeColor: style.look.strokeColor.toUpperCase() } : {}),
    ...(style.look.glowColor ? { glowColor: style.look.glowColor.toUpperCase() } : {}),
  }));
  return {
    name: meta.name,
    referenceIds: meta.referenceIds,
    kind,
    ...(raw.face && raw.face.heightPercent >= 3 ? { face: raw.face } : {}),
    caption: {
      topPercent: raw.caption.topPercent,
      ...(objectBelow < 100 && captionBottom <= objectBelow + 2 ? { bottomPercent: Math.round(Math.min(captionBottom, objectBelow - 1) * 10) / 10 } : {}),
      xPercent: clamp(raw.caption.xPercent, 15, 85),
      maxWidthPercent: clamp(raw.caption.maxWidthPercent, 30, 96),
      fontSize: captionSize,
      fontFamily: captionLook.fontFamily ?? "Noto Sans JP",
      style: raw.caption.style,
      textColor: captionLook.color,
      accentColor: raw.caption.style === "pill" ? captionLook.bandColor ?? "#000000" : captionLook.strokeColor ?? "#000000",
    },
    emphasisStyles:
      emphasisStyles.length > 0
        ? emphasisStyles
        : [{ role: "話の要点", fontFamily: captionLook.fontFamily ?? "Noto Sans JP", textColor: "#FFE14D", bandColor: null, strokeColor: "#000000" }],
    title: {
      align: raw.title.align,
      xPercent: raw.title.xPercent,
      yPercent: raw.title.yPercent,
      fontSizePx: titleFont,
      maxWidthPercent: clamp(raw.title.maxWidthPercent, 20, 96),
      lineCount: clamp(raw.title.lines.length, 1, 3),
      // タイトルの後ろに端から端までの帯がある時は、行ごとの帯は描かない(帯が二重になるため)
      lines: raw.title.lines.map((line) => {
        const look = toLook(line);
        if (raw.title.band && raw.title.band.heightPercent >= 1) delete look.bandColor;
        return look;
      }),
      ...(raw.title.wording.trim() ? { wording: raw.title.wording.trim() } : {}),
      ...(raw.title.band && raw.title.band.heightPercent >= 1 ? { band: raw.title.band } : {}),
      ...(raw.title.intro && raw.title.intro.seconds >= 0.3
        ? {
            intro: {
              seconds: clamp(raw.title.intro.seconds, 0.5, 5),
              xPercent: raw.title.intro.xPercent,
              yPercent: raw.title.intro.yPercent,
              fontSizePx: fontPx(raw.title.intro.charHeightPercent, 40, 160),
            },
          }
        : {}),
    },
    ...(kind === "ranking" && raw.frames
      ? {
          frames: {
            xPercent: raw.frames.xPercent,
            widthPercent: clamp(raw.frames.widthPercent, 10, 90),
            topPercent: raw.frames.topPercent,
            bottomPercent: Math.max(raw.frames.topPercent + 10, raw.frames.bottomPercent),
            gapPercent: clamp(raw.frames.gapPercent, 0, 6),
            maxHeightPercent: clamp(
              (raw.frames.bottomPercent - raw.frames.topPercent - raw.frames.gapPercent * (Math.max(1, raw.frames.count) - 1)) / Math.max(1, raw.frames.count),
              5,
              30
            ),
            defaultCount: clamp(Math.round(raw.frames.count), 2, 10),
            shape: {
              ...(raw.frames.borderColor ? { borderColor: raw.frames.borderColor.toUpperCase() } : {}),
              borderWidthPx: clamp(Math.round(raw.frames.borderWidthPx), 0, 20),
              ...(raw.frames.fillColor ? { fillColor: raw.frames.fillColor.toUpperCase() } : {}),
              fillOpacity: 1,
              cornerRadiusPx: clamp(Math.round(raw.frames.cornerRadiusPx), 0, 60),
            },
            number: {
              format: raw.frames.numberFormat.includes("{n}") ? raw.frames.numberFormat : "{n}位",
              fontSizePx: fontPx(raw.frames.numberCharHeightPercent, 24, 90),
              looks: raw.frames.numberLooks.map(toLook),
            },
            content: raw.frames.content,
            label: { fontSizePx: fontPx(raw.frames.label.charHeightPercent, 24, 90), look: toLook(raw.frames.label.look) },
            ...(raw.frames.popup && raw.frames.popup.widthPercent >= 10
              ? {
                  popup: {
                    xPercent: raw.frames.popup.xPercent,
                    yPercent: raw.frames.popup.yPercent,
                    widthPercent: raw.frames.popup.widthPercent,
                    heightPercent: raw.frames.popup.heightPercent,
                    seconds: clamp(raw.frames.popup.seconds, 0.6, 4),
                    name: {
                      fontSizePx: fontPx(raw.frames.popup.name.charHeightPercent, 24, 100),
                      look: toLook(raw.frames.popup.name.look),
                      yPercent: raw.frames.popup.name.yPercent,
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(kind === "compare" && raw.compare
      ? {
          compare: {
            row: {
              yPercent: raw.compare.yPercent,
              heightPercent: clamp(raw.compare.heightPercent, 5, 50),
              leftPercent: raw.compare.leftPercent,
              rightPercent: Math.max(raw.compare.leftPercent + 20, raw.compare.rightPercent),
              gapPercent: clamp(raw.compare.gapPercent, 0, 10),
            },
            shape: {
              ...(raw.compare.borderColor ? { borderColor: raw.compare.borderColor.toUpperCase() } : {}),
              borderWidthPx: clamp(Math.round(raw.compare.borderWidthPx), 0, 20),
              ...(raw.compare.fillColor ? { fillColor: raw.compare.fillColor.toUpperCase() } : {}),
              fillOpacity: 1,
              cornerRadiusPx: clamp(Math.round(raw.compare.cornerRadiusPx), 0, 60),
            },
            content: raw.compare.content,
            name: {
              fontSizePx: fontPx(raw.compare.name.charHeightPercent, 24, 100),
              look: toLook(raw.compare.name.look),
              fromBottomPercent: clamp(raw.compare.name.fromBottomPercent, 1, raw.compare.heightPercent / 2),
            },
            ...(raw.compare.contentText
              ? { contentText: { fontSizePx: fontPx(raw.compare.contentText.charHeightPercent, 24, 110), look: toLook(raw.compare.contentText.look) } }
              : {}),
            ...(raw.compare.topic
              ? {
                  topic: {
                    xPercent: raw.compare.topic.xPercent,
                    yPercent: raw.compare.topic.yPercent,
                    fontSizePx: fontPx(raw.compare.topic.charHeightPercent, 24, 100),
                    look: toLook(raw.compare.topic.look),
                  },
                }
              : {}),
            ...(raw.compare.marker
              ? { marker: { color: raw.compare.marker.color.toUpperCase(), strokeWidthPx: clamp(Math.round(raw.compare.marker.strokeWidthPx), 4, 24) } }
              : {}),
          },
        }
      : {}),
    ...(raw.cta
      ? {
          cta: {
            xPercent: raw.cta.xPercent,
            yPercent: raw.cta.yPercent,
            fontSizePx: fontPx(raw.cta.charHeightPercent, 28, 120),
            look: toLook(raw.cta.look),
            seconds: clamp(raw.cta.seconds, 1, 10),
            maxWidthPercent: clamp(raw.cta.maxWidthPercent, 40, 96),
          },
        }
      : {}),
  };
};

/** 文字ごとに、見た目を確かめ直す所の名前と、その見た目・文字の大きさの置き場所。 */
type LookSlot = {
  id: string;
  what: string;
  look: RawLook;
  setLook: (look: RawLook) => void;
  setCharHeight?: (percent: number) => void;
  /** その文字の高さ(%。分かる時だけ)。AIの答えた箱が字より低すぎる時に、箱を広げるのに使う。 */
  charHeight?: number;
};

/**
 * AIが答えた字の箱を直す(EC-5)。箱は中心の位置で答えるよう頼んでいるが、字幕や強調の箱を左端の位置で答えることがあり
 * (x=10・幅80 など)、色を測る所が字幕から外れていた。箱が画面の外にはみ出す時は、左端・上端で答えたとみなして中心に直す。
 * 高さが字の高さより低すぎる時は、字の高さの1.6倍に広げる。
 */
export const fixBox = (
  box: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  charHeight?: number
): { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } => {
  let { xPercent, yPercent, heightPercent } = box;
  const { widthPercent } = box;
  if (xPercent - widthPercent / 2 < -2 && xPercent + widthPercent / 2 <= 102) xPercent += widthPercent / 2;
  if (yPercent - heightPercent / 2 < -2) yPercent += heightPercent / 2;
  if (charHeight && heightPercent < charHeight * 1.2) heightPercent = charHeight * 1.6;
  return { xPercent, yPercent, widthPercent, heightPercent };
};

const lookSlots = (raw: ExtractedTemplate): LookSlot[] => {
  const slots: LookSlot[] = [
    { id: "caption", what: "ふつうの字幕", look: raw.caption.look, setLook: (look) => (raw.caption.look = look), setCharHeight: (v) => (raw.caption.charHeightPercent = v), charHeight: raw.caption.charHeightPercent },
    ...raw.emphasisStyles.map((style, i) => ({ id: `emphasis${i + 1}`, what: `強調した字幕(${style.role})`, look: style.look, setLook: (look: RawLook) => (style.look = look), charHeight: raw.caption.charHeightPercent * (style.scale || 1) })),
    ...raw.title.lines.map((line, i) => ({
      id: `title${i + 1}`,
      what: `タイトルの${i + 1}行目`,
      look: line,
      setLook: (look: RawLook) => (raw.title.lines[i] = look),
      charHeight: raw.title.charHeightPercent,
      ...(i === 0 ? { setCharHeight: (v: number) => (raw.title.charHeightPercent = v) } : {}),
    })),
  ];
  const frames = raw.frames;
  if (frames) {
    frames.numberLooks.forEach((look, i) =>
      slots.push({
        id: `number${i + 1}`,
        what: `ランキングの枠の${i + 1}番目の番号`,
        look,
        setLook: (next) => (frames.numberLooks[i] = next),
        ...(i === 0 ? { setCharHeight: (v: number) => (frames.numberCharHeightPercent = v) } : {}),
      })
    );
    if (frames.content === "text") slots.push({ id: "label", what: "枠の中の項目名", look: frames.label.look, setLook: (look) => (frames.label.look = look), setCharHeight: (v) => (frames.label.charHeightPercent = v) });
    const popup = frames.popup;
    if (popup) slots.push({ id: "popupName", what: "大きく出した項目の名前", look: popup.name.look, setLook: (look) => (popup.name.look = look), setCharHeight: (v) => (popup.name.charHeightPercent = v) });
  }
  const compare = raw.compare;
  if (compare) {
    slots.push({ id: "name", what: "カードの中の比べる物の名前", look: compare.name.look, setLook: (look) => (compare.name.look = look), setCharHeight: (v) => (compare.name.charHeightPercent = v) });
    const contentText = compare.contentText;
    if (contentText) slots.push({ id: "contentText", what: "カードの中の文字", look: contentText.look, setLook: (look) => (contentText.look = look), setCharHeight: (v) => (contentText.charHeightPercent = v) });
    const topic = compare.topic;
    if (topic) slots.push({ id: "topic", what: "今の話題の見出し", look: topic.look, setLook: (look) => (topic.look = look), setCharHeight: (v) => (topic.charHeightPercent = v) });
  }
  const cta = raw.cta;
  if (cta) slots.push({ id: "cta", what: "最後の一言", look: cta.look, setLook: (look) => (cta.look = look), setCharHeight: (v) => (cta.charHeightPercent = v) });
  return slots;
};

/** 箱を少し広げる(縁取り・光が切れないように)。 */
const widen = (box: RawLook["box"], ratio = 0.2) => {
  const w = Math.min(100, box.widthPercent * (1 + ratio * 2) + 2);
  const h = Math.min(100, box.heightPercent * (1 + ratio * 2) + 1);
  const x = Math.min(100 - w / 2, Math.max(w / 2, box.xPercent));
  const y = Math.min(100 - h / 2, Math.max(h / 2, box.yPercent));
  return { xPercent: x, yPercent: y, widthPercent: w, heightPercent: h };
};

/** 文字の所を拡大して切り抜いた絵(PNG)。 */
const cropAt = async (file: StyleReferenceFile, seconds: number, box: RawLook["box"]): Promise<Buffer | null> => {
  const area = widen(box);
  const outWidth = 640;
  const outHeight = Math.max(32, Math.min(720, Math.round((outWidth * (area.heightPercent * 16)) / (area.widthPercent * 9) / 2) * 2));
  const seek = file.kind === "video" ? ["-ss", String(seconds)] : [];
  const crop = `crop=iw*${(area.widthPercent / 100).toFixed(4)}:ih*${(area.heightPercent / 100).toFixed(4)}:iw*${((area.xPercent - area.widthPercent / 2) / 100).toFixed(4)}:ih*${((area.yPercent - area.heightPercent / 2) / 100).toFixed(4)}`;
  const result = await callFf("ffmpeg", [
    "-v", "error", ...seek, "-i", file.absolutePath, "-frames:v", "1", "-vf", `${crop},scale=${outWidth}:${outHeight}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2pipe", "-",
  ]);
  const pixels = new Uint8Array(result.stdout as unknown as Buffer);
  if (pixels.length < outWidth * outHeight * 3) return null;
  return encodePng(pixels, outWidth, outHeight);
};

export const LOOK_CHECK_PROMPT = (slots: { id: string; what: string }[]) => `
上は、見た目の手本の文字を、1つずつ拡大して切り抜いた絵です(【名前】の次の絵)。それぞれの文字の見た目を、よく見て答えてください。
${slots.map((slot) => `- ${slot.id}: ${slot.what}`).join("\n")}

- color: 字の線の内側(真ん中)の色。strokeColor: その外側を囲む縁の色(無ければnull)。2つを取り違えない。
  例: 黄色い字を黒い太い縁が囲んでいれば color=黄・strokeColor=黒。黒い字を白い縁が囲んでいれば color=黒・strokeColor=白。
  縁が二重(内側の縁と外側の縁)の時は、内側の縁を strokeColor、外側を glowColor にする。
- bandColor: 文字の後ろの帯・板の色(無ければnull)。glowColor: 文字の周りの光・にじみ・影の色(無ければnull)。
- fontFamily: 次から一番近い書体: ${FONT_HINTS}
  明朝体(Noto Serif JP など)は縦の線が太く横の線が細く、線の終わりに三角の飾りがある。丸ゴシック(M PLUS Rounded 1c)は線の端が丸い。
  飾りや崩しの無い、ふつうの太いゴシックは Noto Sans JP(標準ゴシック)。ポップな書体(Mochiy Pop One・Reggae One・Potta One・Dela Gothic One など)は、
  字の形が丸く崩してある・極端に太い・飾りがある、とはっきり分かる時だけ選ぶ(太い縁取りが付いているだけなら、ふつうのゴシック)。
- found: 切り抜きに、その文字がはっきり写っていれば true(写っていない・別の物が写っている時は false)。
- text: 切り抜きに写っている文字(写っているまま。改行・空白は入れない。読めなければ空)。
色は #RRGGBB。切り抜きごとに、id を付けて答えてください。
`.trim();

/** ふつうの文字の、字の高さに対する文字の大きさ(漢字は字の大きさの約88%の高さで描かれる)。 */
const INK_RATIO = 0.88;

/**
 * 文字の色の画素が縦に続く所の高さ(画面の高さに対する%)を測る。行ごとに、文字の色の画素がある所をつなげ、
 * その長さの真ん中の値を、字の高さとする。測れなければ null。
 */
export const measureInkHeight = (
  pixels: Uint8Array,
  width: number,
  height: number,
  box: RawLook["box"],
  color: string,
  /** 文字のすぐ外側の色(縁取りか帯)。あれば、そのすぐそばにある文字の色の画素だけを数える(後ろの白い物などを文字と数えないように)。 */
  edgeColor?: string | null
): number | null => {
  const target = hexToRgb(color);
  const edge = edgeColor ? hexToRgb(edgeColor) : null;
  const x0 = Math.max(0, Math.floor(((box.xPercent - box.widthPercent / 2) / 100) * width));
  const x1 = Math.min(width, Math.ceil(((box.xPercent + box.widthPercent / 2) / 100) * width));
  const area = widen(box, 0.1);
  const y0 = Math.max(0, Math.floor(((area.yPercent - area.heightPercent / 2) / 100) * height));
  const y1 = Math.min(height, Math.ceil(((area.yPercent + area.heightPercent / 2) / 100) * height));
  const at = (x: number, y: number): Rgb => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  const REACH = 4;
  const nearEdge = (x: number, y: number) => {
    if (!edge) return true;
    for (let d = 1; d <= REACH; d++) {
      if (distance(at(x - d, y), edge) < 60 || distance(at(x + d, y), edge) < 60 || distance(at(x, y - d), edge) < 60 || distance(at(x, y + d), edge) < 60) return true;
    }
    return false;
  };
  const minCount = Math.max(2, Math.round((x1 - x0) * 0.02));
  const rows: boolean[] = [];
  for (let y = y0; y < y1; y++) {
    let count = 0;
    for (let x = x0; x < x1; x++) {
      if (distance(at(x, y), target) < 55 && nearEdge(x, y)) count++;
    }
    rows.push(count >= minCount);
  }
  const runs: number[] = [];
  let run = 0;
  let gap = 0;
  for (const on of [...rows, false, false]) {
    if (on) {
      run += gap + 1;
      gap = 0;
    } else if (run > 0 && gap < 1) {
      gap++;
    } else {
      if (run >= 4) runs.push(run);
      run = 0;
      gap = 0;
    }
  }
  if (runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return (median / height) * 100;
};

/** 字幕の数え方の指示文。 */
export const CAPTION_SURVEY_PROMPT = (times: number[]) => `
上は、見た目の手本の動画から、字幕が出る所を1秒ごとに切り抜いた絵です(【秒数】の次の絵。${times.length}枚)。
字幕(話した言葉の文字)の見た目を、見た目ごとのグループに分けて、どの絵に出ているかを全部挙げてください。
- 見た目が同じ(文字の色・縁取りの色・帯・光・書体が同じ)字幕は、同じグループ。文言は違ってよい。
- 字幕が写っていない絵、TikTokのロゴ・投稿者名だけの絵は数えない。タイトル・枠の中の文字・見出しの帯も数えない(話した言葉の字幕だけ)。
- 絵を1枚ずつ順に見て、字幕が写っていれば、その見た目のグループの appearsAt にその絵の秒数を入れる(1枚の絵は1つのグループだけ)。
  数を答えるのではなく、写っていた絵の秒数を全部挙げる(ツールが数える。一番多いグループが、ふつうの字幕になる)。
- グループごとに: appearsAt(写っていた絵の秒数を全部)、seconds(そのグループの字幕がはっきり写っている絵の秒数を1つ)、
  examples(写っていた文言を2〜4個)、role(どんな言葉に使われているか。例「ふつうに話している言葉」「数字・金額」「問いかけ・否定」)、
  look(fontFamily・color・strokeColor・bandColor・glowColor)、box(その秒の絵の中での字幕の箱。絵の幅・高さに対する%)。
- color は字の線の内側(真ん中)の色、strokeColor はその外側を囲む縁の色(取り違えない)。縁が二重なら、内側の縁を strokeColor、外側を glowColor。
- 書体は次から一番近い物: ${FONT_HINTS}
  飾りや崩しの無い、ふつうの太いゴシックは Noto Sans JP。明朝体は縦の線が太く横の線が細く、線の終わりに三角の飾りがある。丸ゴシックは線の端が丸い。
写っていた絵が多い順に答えてください。
`.trim();

/** 冒頭のタイトルの出し方を聞き直す指示文。 */
export const INTRO_CHECK_PROMPT = (times: number[], title: { xPercent: number; yPercent: number }) => `
上は、見た目の手本の動画の、冒頭の場面の絵です(${times.map((t) => `${t.toFixed(1)}秒`).join("・")})。赤紫の線は5%ごとの目盛り(数字は%)。
この動画のタイトルは、ふだんは横${Math.round(title.xPercent)}%・縦${Math.round(title.yPercent)}%あたりに出ています。
冒頭だけ、タイトル(同じ文言)を、ふだんの所とは別の所(画面の真ん中あたり等)に大きく出していますか。
- 出していれば found=true。seconds=大きく出すのをやめて、ふだんの所に収まる秒数。xPercent・yPercent=大きく出していた時の文字の固まりの中心。charHeightPercent=その時の漢字1文字の高さ(画面の高さに対する%)。
- 冒頭からふだんの所に小さく出ているだけ、または話した言葉の字幕しか出ていなければ found=false(その時の数字は0)。
`.trim();

/**
 * 冒頭に大きく出すタイトルを、最初の数秒の場面だけを見せて確かめる。
 * 全体の型を読む時は、見る物が多くて、冒頭の大きなタイトルを見落とすことがあったため(見落とした時だけ聞き直す)。
 */
const checkIntro = async (raw: ExtractedTemplate, file: StyleReferenceFile, duration: number): Promise<ExtractedTemplate> => {
  if (raw.title.intro || file.kind !== "video" || duration <= 6) return raw;
  const times = [0.3, 1, 1.8, 2.6, 3.5, 5];
  const parts: Part[] = [];
  for (const seconds of times) {
    const png = await stillAt(file, seconds).catch(() => null);
    if (png) parts.push({ text: `【${seconds.toFixed(1)}秒】` }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
  }
  if (parts.length === 0) return raw;
  const answer = await askJson({
    model: STEP_MODEL,
    label: "見た目の手本の冒頭のタイトル",
    timeoutMs: EXTRACT_TIMEOUT_MS,
    parts: [...parts, { text: INTRO_CHECK_PROMPT(times, raw.title) }],
    schema: obj({ found: { type: Type.BOOLEAN }, seconds: num, xPercent: num, yPercent: num, charHeightPercent: num }),
    parse: z.object({ found: z.boolean(), seconds: positive, xPercent: percent, yPercent: percent, charHeightPercent: percent }),
  }).catch(() => null);
  if (!answer?.found || answer.seconds < 0.3 || answer.charHeightPercent <= 0) return raw;
  // ふだんの所とほとんど同じ所なら、冒頭に別に出しているのではない
  if (Math.abs(answer.yPercent - raw.title.yPercent) < 8) return raw;
  return {
    ...raw,
    title: { ...raw.title, intro: { seconds: answer.seconds, xPercent: answer.xPercent, yPercent: answer.yPercent, charHeightPercent: answer.charHeightPercent } },
  };
};

type SurveyGroup = { color: string; edge: string | null; seconds: number; appearsAt: number[]; box?: RawLook["box"] };

/**
 * 字幕の見た目ごとに、写っていた切り抜きの数を画素から数える。
 * 1. 見た目ごとに、その見本の切り抜きで実際に多い色に、文字の色と縁(か帯)の色を合わせる(AIの答えた色は、ずれや入れ替わりがある)。
 *    見本の切り抜きの中でさえ、その2色が隣り合っていなければ、測れない見た目として、AIの挙げた秒数で数える。
 * 2. 色の近い見た目どうし、文字の色と縁の色が入れ替わっただけの見た目どうしは、1つにまとめ、AIが多く挙げた方に数える。
 * 3. 切り抜きごとに、文字の色と縁の色が隣り合う画素が一番多い見た目に1つ数える。ただし、ある見た目の文字の色が、
 *    同時に写っている別の見た目の縁の色にすぎない時(水色の字の白い縁と、その外の黒い影を、白い字に黒い縁と数える等)は、別の見た目の方を採る。
 *    見本の切り抜きより、ずっと弱い一致(肌の色をたまたま縁の色と数えた等)は数えない。
 */
export const countCaptionLooks = (groups: SurveyGroup[], crops: Map<string, Uint8Array>, width: number, height: number) => {
  const MATCH = 0.004;
  const TOLERANCE = 50;
  const near = (a: string, b: string | null, limit = 80) => !!b && distance(hexToRgb(a), hexToRgb(b)) <= limit;
  // 1. 見本の切り抜きで色を合わせる
  const prepared = groups.map((group) => {
    const key = [group.seconds, ...group.appearsAt].map((t) => t.toFixed(1)).find((t) => crops.has(t));
    const own = key ? crops.get(key) : undefined;
    if (!own || !group.edge) return { color: group.color, edge: group.edge, ownScore: 0, countable: false };
    // 色は、その字幕の箱の中で測る(帯全体だと、字幕の文字の色は少なすぎて多い色に入らない)
    const measured = dominantColors(own, width, height, group.box ?? FULL_BOX);
    const found = (guess: string, exclude: Rgb[] = []) => {
      const snapped = snapColor(guess, measured, exclude);
      return measured.some((rgb) => rgbToHex(rgb) === snapped) ? snapped : null;
    };
    const color = found(group.color);
    const edge = color ? found(group.edge, [hexToRgb(color)]) : null;
    if (!color || !edge) return { color: group.color, edge: group.edge, ownScore: 0, countable: false };
    const ownScore = edgePairScore(own, width, height, FULL_BOX, color, edge, TOLERANCE);
    return { color, edge, ownScore, countable: ownScore >= MATCH };
  });
  // 2. 同じ見た目をまとめる(代表は、AIが多く挙げた方)
  const leader = groups.map((_, index) => index);
  const rootOf = (index: number): number => {
    while (leader[index] !== index) index = leader[index];
    return index;
  };
  // 色は、合わせた色どうしか、AIの答えた色どうしで比べる(測れなかった見た目も、同じ見た目ならまとめる)
  const sameLook = (a: { color: string; edge: string | null }, b: { color: string; edge: string | null }, limit: number) =>
    !!a.edge && !!b.edge && ((near(a.color, b.color, limit) && near(a.edge, b.edge, limit)) || (near(a.color, b.edge, limit) && near(a.edge, b.color, limit)));
  prepared.forEach((a, i) =>
    prepared.forEach((b, j) => {
      if (j <= i) return;
      const same = (a.countable && b.countable && sameLook(a, b, 50)) || sameLook(groups[i], groups[j], 60);
      if (!same) return;
      const [ri, rj] = [rootOf(i), rootOf(j)];
      if (ri === rj) return;
      if (groups[ri].appearsAt.length >= groups[rj].appearsAt.length) leader[rj] = ri;
      else leader[ri] = rj;
    })
  );
  const roots = [...new Set(prepared.flatMap((p, i) => (p.countable ? [rootOf(i)] : [])))];
  const ownScoreOf = (root: number) => Math.max(...prepared.map((p, i) => (p.countable && rootOf(i) === root ? p.ownScore : 0)));
  // 3. 切り抜きごとに数える
  const pixelCount = new Map<number, number>(roots.map((root) => [root, 0]));
  for (const pixels of crops.values()) {
    const matched = roots
      .map((root) => {
        const { color, edge } = prepared[root];
        return { root, color, edge: edge ?? color, score: edge ? edgePairScore(pixels, width, height, FULL_BOX, color, edge, TOLERANCE) : 0 };
      })
      .filter((entry) => entry.score >= Math.max(MATCH, ownScoreOf(entry.root) * 0.25));
    const kept = matched.filter((entry) => !matched.some((other) => other !== entry && near(entry.color, other.edge) && !near(entry.color, other.color)));
    const best = (kept.length > 0 ? kept : matched).reduce<(typeof matched)[number] | null>((acc, entry) => (!acc || entry.score > acc.score ? entry : acc), null);
    if (best) pixelCount.set(best.root, (pixelCount.get(best.root) ?? 0) + 1);
  }
  const usePixels = [...pixelCount.values()].some((count) => count > 0);
  // まとめた見た目は、代表だけに数える(残りは0にして、強調の見た目にも出さない)。
  // 数は、画素から数えられた見た目はその数(AIは多めに挙げることがある)。数えられなかった見た目は、まとめた見た目のどれかにAIが挙げた秒数の数
  const aiUnion = (root: number) =>
    new Set(groups.flatMap((group, index) => (rootOf(index) === root ? group.appearsAt.map((t) => t.toFixed(1)).filter((t) => crops.has(t)) : []))).size;
  // 代表の色は、色を合わせられた見た目の物を使う
  const colorsOf = (root: number) => {
    const index = prepared[root].countable ? root : prepared.findIndex((p, i) => p.countable && rootOf(i) === root);
    return index >= 0 ? prepared[index] : prepared[root];
  };
  return groups.map((group, index) => {
    if (rootOf(index) !== index) return { count: 0, color: prepared[index].color, edge: prepared[index].edge };
    const { color, edge } = colorsOf(index);
    const pixelRoot = roots.find((root) => rootOf(root) === index);
    return { count: pixelRoot !== undefined && usePixels ? (pixelCount.get(pixelRoot) ?? 0) : aiUnion(index), color, edge };
  });
};

/**
 * 字幕が出る帯(画面の幅いっぱい、字幕の上の端の少し上から、ふだんの行数ぶん下まで)。
 * 広く取ると、字幕のすぐ下の見出しの帯(白い字に黒い帯など)まで入り、字幕と取り違えて数えたため、狭くする。
 */
const captionBand = (raw: ExtractedTemplate) => {
  const lines = Math.min(2, Math.max(1, Math.round(raw.caption.lines)));
  const top = Math.max(0, raw.caption.topPercent - 3);
  const bottom = Math.min(100, raw.caption.topPercent + raw.caption.charHeightPercent * (lines === 2 ? 2.6 : 1.4) + 2);
  return { xPercent: 50, yPercent: (top + bottom) / 2, widthPercent: 100, heightPercent: bottom - top };
};

/**
 * 字幕の見た目を、1秒ごとの字幕の所を全部見て数える。一番多い見た目をふつうの字幕、それ以外を強調した字幕にする。
 * 場面の絵を何枚か見せるだけだと、強調した字幕をふつうの字幕と取り違えることがあったため。
 */
const surveyCaptions = async (raw: ExtractedTemplate, file: StyleReferenceFile, duration: number): Promise<ExtractedTemplate> => {
  if (file.kind !== "video" || duration <= 2) return raw;
  const band = captionBand(raw);
  const times = Array.from({ length: Math.min(70, Math.floor(Math.max(1, duration - 3))) }, (_, i) => i + 0.5);
  const parts: Part[] = [];
  const cropPixels = new Map<string, Uint8Array>();
  const outWidth = 360;
  const outHeight = Math.max(32, Math.round((outWidth * band.heightPercent * 16) / (band.widthPercent * 9) / 2) * 2);
  for (const seconds of times) {
    const crop = `crop=iw:ih*${(band.heightPercent / 100).toFixed(4)}:0:ih*${((band.yPercent - band.heightPercent / 2) / 100).toFixed(4)}`;
    const result = await callFf("ffmpeg", [
      "-v", "error", "-ss", String(seconds), "-i", file.absolutePath, "-frames:v", "1", "-vf", `${crop},scale=${outWidth}:${outHeight}`, "-pix_fmt", "rgb24", "-c:v", "rawvideo", "-f", "image2pipe", "-",
    ]).catch(() => null);
    const pixels = result ? new Uint8Array(result.stdout as unknown as Buffer) : null;
    if (!pixels || pixels.length < outWidth * outHeight * 3) continue;
    cropPixels.set(seconds.toFixed(1), pixels);
    parts.push({ text: `【${seconds.toFixed(1)}秒】` }, { inlineData: { mimeType: "image/png", data: encodePng(pixels, outWidth, outHeight).toString("base64") } });
  }
  if (parts.length === 0) return raw;
  const groupLook = obj({ fontFamily: str, color: colorSchema, strokeColor: nullableColorSchema, bandColor: nullableColorSchema, glowColor: nullableColorSchema });
  const survey = await askJson({
    model: STEP_MODEL,
    label: "見た目の手本の字幕",
    timeoutMs: EXTRACT_TIMEOUT_MS,
    parts: [...parts, { text: CAPTION_SURVEY_PROMPT(times) }],
    schema: {
      type: Type.OBJECT,
      properties: { groups: { type: Type.ARRAY, items: obj({ appearsAt: { type: Type.ARRAY, items: num }, seconds: num, examples: { type: Type.ARRAY, items: str }, role: str, look: groupLook, box: boxSchema }) } },
      required: ["groups"],
    },
    parse: z.object({
      groups: z.array(
        z.object({
          appearsAt: z.array(z.number()).catch([]),
          seconds: positive,
          examples: z.array(z.string()).default([]),
          role: z.string(),
          look: z.object({ fontFamily: fontParse, color: colorParse, strokeColor: nullableColorParse, bandColor: nullableColorParse, glowColor: nullableColorParse }),
          box: boxParse,
        })
      ),
    }),
  }).catch((error: unknown) => {
    console.warn("[referenceTemplate] 字幕の見た目を数えられませんでした", error);
    return { groups: [] };
  });
  // 写っていた絵の数は、こちらで画素から数える(AIに数えさせると、答えるたびに一番多い見た目が変わった)
  const counted = countCaptionLooks(
    survey.groups.map((group) => ({ color: group.look.color, edge: group.look.strokeColor ?? group.look.bandColor, seconds: group.seconds, appearsAt: group.appearsAt, box: group.box })),
    cropPixels,
    outWidth,
    outHeight
  );
  const groups = survey.groups
    .map((group, index) => {
      const { count, color, edge } = counted[index];
      const look = { ...group.look, color };
      if (edge && group.look.strokeColor) look.strokeColor = edge;
      else if (edge && group.look.bandColor) look.bandColor = edge;
      return { ...group, look, count };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count);
  if (groups.length === 0) return raw;
  // 切り抜きの中の箱を、画面全体の箱に直す
  const toScreen = (box: RawLook["box"]): RawLook["box"] => ({
    xPercent: box.xPercent,
    yPercent: band.yPercent - band.heightPercent / 2 + (box.yPercent / 100) * band.heightPercent,
    widthPercent: box.widthPercent,
    heightPercent: (box.heightPercent / 100) * band.heightPercent,
  });
  const lookOf = (group: (typeof groups)[number]): RawLook => ({ ...group.look, seconds: group.seconds, box: toScreen(group.box) });
  const [normal, ...others] = groups;
  return {
    ...raw,
    caption: { ...raw.caption, look: lookOf(normal) },
    emphasisStyles: others
      .filter((group) => group.count >= 1)
      .slice(0, 4)
      .map((group) => ({
        role: `${group.role}${group.examples.length > 0 ? `(手本では「${group.examples.slice(0, 2).join("」「")}」のような言葉)` : ""}`,
        look: lookOf(group),
        scale: 1,
      })),
  };
};

/**
 * AIの答えた文字の見た目を確かめ直す(手元に手本のファイルがある時だけ)。
 * 1. 文字ごとに拡大した切り抜きをAIに見せ、色・縁取り・書体を答え直してもらう(小さい場面の絵より、取り違えが少ない)。
 * 2. 色は、その所で実際に多い色に合わせる。3. 文字の大きさは、文字の色の画素の高さから測る(AIは大きめに読むことが多かった)。
 */
const refineLooks = async (raw: ExtractedTemplate, file: StyleReferenceFile | undefined): Promise<ExtractedTemplate> => {
  if (!file || file.youtubeUrl) return raw;
  const refined: ExtractedTemplate = structuredClone(raw);
  // タイトルは、冒頭に大きく出している間ではなく、いつもの所に収まった後で測る
  // (冒頭の大きなタイトルの秒数は読み取るたびにぶれるので、少なくとも5秒より後にする。タイトルは動画のあいだずっと同じ所にある)
  const settled = Math.max(5, refined.title.intro ? refined.title.intro.seconds + 2.5 : 0);
  refined.title.lines = refined.title.lines.map((line) => (line.seconds < settled ? { ...line, seconds: settled } : line));
  const slots = lookSlots(refined);
  // EC-5: AIが答えた字の箱を直してから、切り抜き・色を測る
  for (const slot of slots) {
    slot.look = { ...slot.look, box: fixBox(slot.look.box, slot.charHeight) };
    slot.setLook(slot.look);
  }
  const secondsOf = (look: RawLook) => (file.kind === "video" ? Math.round(look.seconds * 10) / 10 : 0);
  // 1. 拡大した切り抜きで、見た目を答え直してもらう(写っている文字も答えてもらい、5で描いて比べるのに使う)
  const textOf = new Map<string, string>();
  const crops: Part[] = [];
  const shown: LookSlot[] = [];
  for (const slot of slots) {
    const png = await cropAt(file, secondsOf(slot.look), slot.look.box).catch(() => null);
    if (!png) continue;
    crops.push({ text: `【${slot.id}】` }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
    shown.push(slot);
  }
  if (shown.length > 0) {
    const answers = await askJson({
      model: STEP_MODEL,
      label: "見た目の手本の文字の見た目",
      timeoutMs: EXTRACT_TIMEOUT_MS,
      parts: [...crops, { text: LOOK_CHECK_PROMPT(shown) }],
      schema: {
        type: Type.OBJECT,
        properties: {
          looks: {
            type: Type.ARRAY,
            items: obj({ id: str, found: { type: Type.BOOLEAN }, text: str, fontFamily: str, color: colorSchema, strokeColor: nullableColorSchema, bandColor: nullableColorSchema, glowColor: nullableColorSchema }),
          },
        },
        required: ["looks"],
      },
      parse: z.object({
        looks: z.array(
          z.object({ id: z.string(), found: z.boolean(), text: z.string().catch(""), fontFamily: fontParse, color: colorParse, strokeColor: nullableColorParse, bandColor: nullableColorParse, glowColor: nullableColorParse })
        ),
      }),
    }).catch((error: unknown) => {
      console.warn("[referenceTemplate] 文字の見た目を確かめ直せませんでした", error);
      return { looks: [] };
    });
    for (const answer of answers.looks) {
      const slot = shown.find((item) => item.id === answer.id);
      if (!slot || !answer.found) continue;
      if (answer.text.trim()) textOf.set(slot.id, answer.text.trim());
      slot.look = { ...slot.look, fontFamily: answer.fontFamily, color: answer.color, strokeColor: answer.strokeColor, bandColor: answer.bandColor, glowColor: answer.glowColor };
      slot.setLook(slot.look);
    }
  }
  // 2・3. その所の実際の色に合わせ、字の高さを測る
  const frames = new Map<number, Promise<Buffer | null>>();
  const frameOf = (seconds: number) => {
    if (!frames.has(seconds)) frames.set(seconds, rgbFrameAt(file, seconds, SAMPLE_WIDTH, SAMPLE_HEIGHT).catch(() => null));
    return frames.get(seconds)!;
  };
  for (const slot of slots) {
    const pixels = await frameOf(secondsOf(slot.look));
    if (!pixels || pixels.length < SAMPLE_WIDTH * SAMPLE_HEIGHT * 3) {
      console.info(`[exactCopy] ${slot.id}: ${secondsOf(slot.look)}秒の場面を取り出せない`);
      continue;
    }
    slot.look = { ...slot.look, box: alignBox(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, slot.look.box, slot.look.color, slot.look.strokeColor ?? slot.look.bandColor) };
    const measured = dominantColors(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, slot.look.box);
    if (measured.length === 0) {
      console.info(`[exactCopy] ${slot.id}: 箱の中の色を測れない`);
      continue;
    }
    let color = snapColor(slot.look.color, measured);
    const used = [hexToRgb(color)];
    let strokeColor = slot.look.strokeColor ? snapColor(slot.look.strokeColor, measured, used) : null;
    // 文字の色と縁取りの色が入れ替わっていたら直す
    if (strokeColor && strokeLooksSwapped(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, slot.look.box, color, strokeColor)) {
      [color, strokeColor] = [strokeColor, color];
    }
    if (strokeColor) used.push(hexToRgb(strokeColor));
    const bandColor = slot.look.bandColor ? snapColor(slot.look.bandColor, measured, used) : null;
    slot.setLook({ ...slot.look, color, strokeColor, bandColor, glowColor: keepGlow(slot.look.glowColor, measured, [color, strokeColor, bandColor]) });
    // 5. (EC-5)15書体で同じ文字を描いて比べ、書体と、字の色・縁の色の組み合わせを決める
    const text = textOf.get(slot.id);
    if (!text) console.info(`[exactCopy] ${slot.id}: 写っている文字が分からないので、描いて比べない`);
    if (text) {
      const box = slot.look.box;
      const px = (percent: number, size: number) => Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
      // 字が切れないよう、上下は字の高さの2倍以上、左右は1割広げる(広げて入った上下の別の行は、行のかたまりで外す)
      const halfHeight = Math.max(box.heightPercent, (slot.charHeight ?? 0) * 2) * 0.9;
      const tried = await bestLook({
        pixels,
        width: SAMPLE_WIDTH,
        box: {
          x0: px(box.xPercent - box.widthPercent * 0.6, SAMPLE_WIDTH),
          x1: px(box.xPercent + box.widthPercent * 0.6, SAMPLE_WIDTH),
          y0: px(box.yPercent - halfHeight, SAMPLE_HEIGHT),
          y1: px(box.yPercent + halfHeight, SAMPLE_HEIGHT),
        },
        centerY: px(box.yPercent, SAMPLE_HEIGHT),
        text,
        color,
        strokeColor,
        currentFont: slot.look.fontFamily,
      }).catch((error: unknown) => {
        console.warn("[exactCopy] 書体を描いて比べられませんでした", error);
        return null;
      });
      if (!tried) console.info(`[exactCopy] ${slot.id}「${text}」: 字の形を取り出せない(字${color}・縁${strokeColor ?? "なし"}・箱${JSON.stringify(slot.look.box)})`);
      if (tried) console.info(`[exactCopy] ${slot.id}「${text}」: 一番近いのは ${tried.fontFamily}${tried.swapped ? "(字と縁の色を入れ替え)" : ""}・似かた${tried.score.toFixed(2)}`);
      const match = tried && tried.score >= MIN_MATCH_SCORE ? tried : null;
      if (match) {
        if (match.swapped && strokeColor) [color, strokeColor] = [strokeColor, color];
        // 書体は、もとの(AIが答えた)書体より、はっきり(0.05より多く)似ている時だけ替える(描いて比べる結果はぶれるため)
        const fontFamily = match.scoreOfCurrent !== undefined && match.score - match.scoreOfCurrent <= 0.05 ? slot.look.fontFamily : match.fontFamily;
        slot.setLook({ ...slot.look, fontFamily, color, strokeColor, bandColor, glowColor: keepGlow(slot.look.glowColor, measured, [color, strokeColor, bandColor]) });
        console.info(`[exactCopy] ${slot.id}「${text}」: 描いて比べて ${match.fontFamily}${match.swapped ? "・字と縁の色を入れ替え" : ""}(似かた${match.score.toFixed(2)})`);
      }
    }
    if (slot.setCharHeight) {
      const ink = measureInkHeight(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, slot.look.box, color, strokeColor ?? bandColor);
      // 文字の大きさ(px)は字の高さより少し大きい。測った値がとんでもない時(背景を数えた等)は、AIの答えのまま
      if (ink !== null && ink >= 0.8 && ink <= 12) slot.setCharHeight(ink / INK_RATIO);
    }
  }
  // 4. カードの中の名前の高さを、画素から測る(AIはカードの下端からの高さを大きめに読み、絵を入れる所が狭くなった)
  const compare = refined.compare;
  if (compare) {
    const pixels = await frameOf(secondsOf(compare.name.look));
    if (pixels && pixels.length >= SAMPLE_WIDTH * SAMPLE_HEIGHT * 3) {
      const cardWidth = (compare.rightPercent - compare.leftPercent - compare.gapPercent) / 2;
      const card = { xPercent: compare.leftPercent + cardWidth / 2, yPercent: compare.yPercent, widthPercent: cardWidth, heightPercent: compare.heightPercent };
      const center = measureNameCenter(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, card, compare.name.look.color);
      if (center !== null) compare.name.fromBottomPercent = compare.yPercent + compare.heightPercent / 2 - center;
    }
  }
  // 6. (EC-6)タイトルの帯の透け方と本当の色を測る
  const band = refined.title.band;
  const titleLook = refined.title.lines[0];
  if (band && titleLook) {
    const pixels = await frameOf(secondsOf(titleLook));
    if (pixels && pixels.length >= SAMPLE_WIDTH * SAMPLE_HEIGHT * 3) {
      const textColors = refined.title.lines.flatMap((line) => [line.color, line.strokeColor].filter((value): value is string => Boolean(value)));
      const measuredBand = measureBand(pixels, SAMPLE_WIDTH, SAMPLE_HEIGHT, band, textColors);
      if (measuredBand) {
        (band as typeof band & { opacity?: number }).opacity = measuredBand.opacity;
        band.color = measuredBand.color;
        console.info(`[exactCopy] タイトルの帯: 色${measuredBand.color}・透けない度合い${measuredBand.opacity}`);
      }
    }
  }
  return refined;
};

/**
 * タイトルの帯の透け方と本当の色を測る(EC-6)。帯が透けていると、帯の中に後ろの模様がうっすら見え、明るさがばらつく。
 * 帯の中(文字の色に近い画素は除く)の明るさのばらつきを、帯のすぐ下の同じ高さの背景のばらつきと比べて、透け具合を出す。
 * 帯の本当の色は、測った色から背景の分を差し引いて求める。測れない時は null。
 */
export const measureBand = (
  pixels: Uint8Array,
  width: number,
  height: number,
  band: { topPercent: number; heightPercent: number },
  textColors: string[]
): { color: string; opacity: number } | null => {
  const rows = (top: number, size: number) => {
    const y0 = Math.max(0, Math.round((top / 100) * height));
    const y1 = Math.min(height, Math.round(((top + size) / 100) * height));
    return [y0, y1] as const;
  };
  const texts = textColors.map(hexToRgb);
  const stats = (y0: number, y1: number, skipText: boolean) => {
    let n = 0;
    const sum: Rgb = [0, 0, 0];
    let lum = 0;
    let lum2 = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < width; x++) {
        // 文字の無い左右の端だけで測る(文字のふちの画素を混ぜない)
        if (x > width * 0.16 && x < width * 0.86) continue;
        const i = (y * width + x) * 3;
        const rgb: Rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (skipText && texts.some((t) => distance(rgb, t) < 90)) continue;
        const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        sum[0] += rgb[0];
        sum[1] += rgb[1];
        sum[2] += rgb[2];
        lum += l;
        lum2 += l * l;
        n++;
      }
    }
    if (n < 100) return null;
    const mean = lum / n;
    return { mean: [sum[0] / n, sum[1] / n, sum[2] / n] as Rgb, std: Math.sqrt(Math.max(0, lum2 / n - mean * mean)) };
  };
  const [by0, by1] = rows(band.topPercent + band.heightPercent * 0.1, band.heightPercent * 0.8);
  const [gy0, gy1] = rows(band.topPercent + band.heightPercent * 1.15, band.heightPercent * 0.8);
  const inside = stats(by0, by1, true);
  const below = stats(gy0, gy1, false);
  if (!inside || !below || below.std < 4) return null;
  const opacity = Math.max(0.35, Math.min(1, 1 - inside.std / below.std));
  if (opacity > 0.92) return { color: rgbToHex(inside.mean), opacity: 1 };
  const solve = (k: number) => Math.max(0, Math.min(255, Math.round((inside.mean[k] - (1 - opacity) * below.mean[k]) / opacity)));
  return { color: rgbToHex([solve(0), solve(1), solve(2)]), opacity: Math.round(opacity * 100) / 100 };
};

/**
 * 文字の周りの光は、その所に実際にある色で、文字・縁取り・帯の色とはっきり違う時だけ残す。
 * AIは無い光(特に白)を答えることが多く、そのまま使うと文字が白くぼやけて読みにくくなったため。
 */
export const keepGlow = (glow: string | null, measured: Rgb[], others: (string | null)[]): string | null => {
  if (!glow) return null;
  const target = hexToRgb(glow);
  const used = others.filter((other): other is string => !!other).map(hexToRgb);
  if (used.some((rgb) => distance(rgb, target) <= 80)) return null;
  const present = measured.find((rgb) => distance(rgb, target) <= 60 && used.every((other) => distance(rgb, other) > 40));
  return present ? rgbToHex(present) : null;
};

// ---------- 読み取りと覚えておく所 ----------

const memory = new Map<string, Promise<ReferenceTemplate | null>>();
const cachePath = (key: string) => path.join(CACHE_DIR, `${key.replace(/[^0-9a-zA-Z_-]/g, "_")}.json`);

/** 手本の保存場所から、型を覚えておく時の名前(ファイル名から拡張子を除いた物。YouTubeは動画のID)。 */
export const referenceIdOf = (referencePath: string): string => path.basename(referencePath).replace(/\.[^.]+$/, "");

/**
 * 見た目の手本(1つ目)から型を読み取る。読み取れなかった時は null(今まで通り、AIが手本を見て決める)。
 * 同じ手本なら、2回目からは覚えておいた型を使う。
 */
export const extractReferenceTemplate = (references: StyleReferenceFile[], referencePaths: string[]): Promise<ReferenceTemplate | null> => {
  const file = references[0];
  const referencePath = referencePaths[0];
  if (!file || !referencePath) return Promise.resolve(null);
  const id = referenceIdOf(referencePath);
  const key = `v${EXTRACT_VERSION}_${id}`;
  const running = memory.get(key);
  if (running) return running;
  const task = (async () => {
    const saved = await readFile(cachePath(key), "utf8").then((text) => JSON.parse(text) as ReferenceTemplate).catch(() => null);
    if (saved) return saved;
    const duration = file.kind === "video" && !file.youtubeUrl ? await durationOf(file.absolutePath).catch(() => 0) : 0;
    const stillTimes = file.youtubeUrl ? [] : file.kind === "video" ? stillTimesOf(duration) : [];
    const stills: Part[] = [];
    for (const seconds of stillTimes) {
      const png = await stillAt(file, seconds).catch(() => null);
      if (!png) continue;
      stills.push({ text: `【${seconds.toFixed(1)}秒の場面】` }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
    }
    const media = await referenceMedia(geminiClient(), [file]);
    const raw = await askJson({
      model: STEP_MODEL,
      label: "見た目の手本の型",
      timeoutMs: EXTRACT_TIMEOUT_MS,
      parts: [...media, ...stills, { text: TEMPLATE_EXTRACT_PROMPT(stillTimes) }],
      schema: RESPONSE_SCHEMA,
      parse: RESPONSE_PARSE,
    });
    const withIntro = await checkIntro(raw, file, duration).catch(() => raw);
    const surveyed = await surveyCaptions(withIntro, file, duration).catch(() => withIntro);
    const snapped = await refineLooks(surveyed, file);
    const template = toReferenceTemplate(snapped, { name: "見た目の手本", referenceIds: [id] });
    await mkdir(CACHE_DIR, { recursive: true }).catch(() => undefined);
    await writeFile(cachePath(key), JSON.stringify({ ...template, extractNote: raw.note }, null, 2)).catch(() => undefined);
    return template;
  })().catch((error: unknown) => {
    console.warn("[referenceTemplate] 見た目の手本の型を読み取れませんでした", error);
    // 失敗は覚えない(次の工程で読み取り直す)
    memory.delete(key);
    return null;
  });
  memory.set(key, task);
  return task;
};
