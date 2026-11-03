import { GoogleGenAI, Type, type Part, type Schema } from "@google/genai";
import { z } from "zod";
import type { FaceBox } from "@video/shared/schema";
import { runWithGeminiRateLimit } from "@/lib/gemini/rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "@/lib/gemini/geminiErrors";
import { waitForGeminiFileActive } from "@/lib/gemini/geminiFiles";

/**
 * 工程ごとの編集(編集マニュアルの1〜11)のうち、AIに頼む工程(3・6・8・10)。
 * まとめて全部を頼むと工程ごとの誤差が大きかったため、1回に1つのことだけを、短い指示文で頼む。
 * 工程9(テロップ入力)は、今ある文字起こし(transcribeCaptions)を使う。
 */

/** 判断のいる工程(3・8・10)のモデル。顔の位置(6)は軽いモデルで足りる。 */
const STEP_MODEL = process.env.GEMINI_STEP_MODEL || "gemini-pro-latest";
const FACE_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

const client = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEYが未設定です");
  return new GoogleGenAI({ apiKey });
};

/**
 * 同じ動画を工程ごとに何度もアップロードしないよう、アップロードした動画を覚えておく(Geminiの側では48時間残る)。
 * サーバーが再起動すれば消えるが、その時はアップロードし直すだけ。
 */
const uploadedVideos = new Map<string, { uri: string; expiresAt: number }>();
const UPLOAD_REUSE_MS = 40 * 60 * 60 * 1000;

const videoPart = async (ai: GoogleGenAI, absolutePath: string, mimeType: string): Promise<Part> => {
  const cached = uploadedVideos.get(absolutePath);
  if (cached && cached.expiresAt > Date.now()) return { fileData: { fileUri: cached.uri, mimeType } };
  const uploaded = await ai.files.upload({ file: absolutePath, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) throw new Error("動画のアップロードに失敗しました");
  await waitForGeminiFileActive(ai, uploaded.name);
  uploadedVideos.set(absolutePath, { uri: uploaded.uri, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return { fileData: { fileUri: uploaded.uri, mimeType } };
};

/** JSONで答えてもらい、形を確かめて返す。混んでいる時だけ少し待って頼み直す。 */
const askJson = async <T>(params: {
  model: string;
  parts: Part[];
  schema: Schema;
  parse: z.ZodType<T>;
  label: string;
}): Promise<T> => {
  const ai = client();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGeminiRateLimit(() =>
        Promise.race([
          ai.models.generateContent({
            model: params.model,
            contents: [{ role: "user", parts: params.parts }],
            config: { responseMimeType: "application/json", responseSchema: params.schema },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Gemini API timeout")), TIMEOUT_MS)),
        ])
      );
      const parsed = params.parse.safeParse(JSON.parse(response.text ?? "{}"));
      if (!parsed.success) throw new Error(`${params.label}: AIの答えの形が違いました`);
      return parsed.data;
    } catch (error) {
      lastError = error;
      if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 8_000 * attempt));
        continue;
      }
      if (error instanceof SyntaxError && attempt < MAX_ATTEMPTS) continue;
      throw toFriendlyGeminiError(error);
    }
  }
  throw toFriendlyGeminiError(lastError);
};

const seconds = (value: number) => `${(Math.round(value * 10) / 10).toFixed(1)}秒`;

/** 工程3の指示文。 */
export const MISTAKES_PROMPT = (ranges: { start: number; end: number }[]) => `
添付した動画は、歯科医院の先生などが話しているショート動画の素材です。
次の範囲(元の動画の秒数)が、今使っている部分です:
${ranges.map((range, index) => `${index + 1}. ${seconds(range.start)}〜${seconds(range.end)}`).join("\n")}

この範囲の中から、編集で切るべき「言い間違い」と「言葉に詰まった部分」だけを探してください。
- 言い間違い: 言い直している所の、間違えた方(言い直す前)の言葉。言い直した後の正しい言葉は残す。
- 言葉に詰まった部分: 「えーと」「あのー」「えー」などの言葉にならない声、同じ言葉を繰り返してつかえている所。
- 話の内容として必要な言葉、言い直していない普通の言葉、間(無音)は切らない(無音は別の工程で切る)。
- 切る範囲は、その言葉の頭から終わりまでをできるだけ正確に、0.1秒単位で書く。迷う所は切らない。
- 見つからなければ空の配列で答える。

各項目に、切る理由(reason: 「言い間違い」か「詰まり」)と、その部分で言っている言葉(text)を書いてください。
`.trim();

/** 3. 言い間違いや言葉に詰まった部分を探す。 */
export const findMistakes = async (input: {
  absolutePath: string;
  mimeType: string;
  ranges: { start: number; end: number }[];
}): Promise<{ start: number; end: number; reason: string; text: string }[]> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "言い間違いの検出",
    parts: [part, { text: MISTAKES_PROMPT(input.ranges) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        cuts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startSeconds: { type: Type.NUMBER },
              endSeconds: { type: Type.NUMBER },
              reason: { type: Type.STRING },
              text: { type: Type.STRING },
            },
            required: ["startSeconds", "endSeconds", "reason", "text"],
          },
        },
      },
      required: ["cuts"],
    },
    parse: z.object({
      cuts: z.array(z.object({ startSeconds: z.number(), endSeconds: z.number(), reason: z.string(), text: z.string() })),
    }),
  });
  return result.cuts
    .filter((cut) => cut.endSeconds > cut.startSeconds && cut.endSeconds - cut.startSeconds < 5)
    .map((cut) => ({ start: cut.startSeconds, end: cut.endSeconds, reason: cut.reason, text: cut.text }));
};

/** 工程6の指示文。 */
export const FACE_PROMPT = `
添付した動画で話している人の顔が、画面のどこに映っているかを答えてください。動画の大半で映っている位置にします。
xPercent/yPercentは顔の中心、widthPercent/heightPercentは顔(髪の生え際からあごまで)の幅・高さで、
どれも画面の幅・高さに対する割合(0〜100)です。顔が映っていなければfoundをfalseにしてください。
`.trim();

/** 6. 話している人の顔の位置を調べる。 */
export const detectFace = async (input: { absolutePath: string; mimeType: string }): Promise<FaceBox | null> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: FACE_MODEL,
    label: "顔の位置",
    parts: [part, { text: FACE_PROMPT }],
    schema: {
      type: Type.OBJECT,
      properties: {
        found: { type: Type.BOOLEAN },
        xPercent: { type: Type.NUMBER },
        yPercent: { type: Type.NUMBER },
        widthPercent: { type: Type.NUMBER },
        heightPercent: { type: Type.NUMBER },
      },
      required: ["found"],
    },
    parse: z.object({
      found: z.boolean(),
      xPercent: z.number().optional(),
      yPercent: z.number().optional(),
      widthPercent: z.number().optional(),
      heightPercent: z.number().optional(),
    }),
  });
  if (!result.found || result.xPercent === undefined || result.yPercent === undefined) return null;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    xPercent: clamp(result.xPercent, 0, 100),
    yPercent: clamp(result.yPercent, 0, 100),
    widthPercent: clamp(result.widthPercent ?? 25, 5, 100),
    heightPercent: clamp(result.heightPercent ?? 18, 5, 100),
  };
};

/** 工程8の指示文。 */
export const OBJECTS_PROMPT = `
添付した動画は、歯科医院などのショート動画の素材です。編集で画面に置く物を2つ決めてください。

1. title: 動画の最初から最後まで、画面の左上に出すタイトル。何の話かが一目でわかる短い言葉(全角16文字以内)。
   話の中に出てくる治療名・症状名を、話したとおりに1つ入れる。2行にするなら意味の切れ目に「\\n」を1つだけ入れる。
   「絶対」「最強」「No.1」「〇〇初」「大人気」のような誇大・比較の言葉は使わない。言っていない数字は入れない。
2. frameCount: ランキングや「〇選」のように、話の中で項目を順に挙げていく動画なら、その項目の数(2〜10)。
   ランキングの枠をその数だけ並べる。項目を順に挙げる動画でなければ0。

reasonに、そう決めた理由を1文で書いてください。
`.trim();

/** 8. 左上のタイトルと、ランキングの枠の数を決める。 */
export const decideObjects = async (input: {
  absolutePath: string;
  mimeType: string;
}): Promise<{ title: string; frameCount: number; reason: string }> => {
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "タイトルと枠",
    parts: [part, { text: OBJECTS_PROMPT }],
    schema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        frameCount: { type: Type.INTEGER },
        reason: { type: Type.STRING },
      },
      required: ["title", "frameCount", "reason"],
    },
    parse: z.object({ title: z.string(), frameCount: z.number().int(), reason: z.string() }),
  });
  return { title: result.title.trim().slice(0, 20), frameCount: Math.max(0, Math.min(10, result.frameCount)), reason: result.reason };
};

/** 工程10の指示文。 */
export const EMPHASIS_PROMPT = (captions: string[]) => `
次は、ショート動画の字幕を順に並べたものです(番号: 字幕)。
${captions.map((caption, index) => `${index + 1}: ${caption.replace(/\n/g, "")}`).join("\n")}

この中から、強調テロップ(基本の字幕とは違う、目立つ見た目の字幕)にしたい字幕を選んでください。
- 選ぶのは、見ている人に一番残したい言葉が入った字幕: 項目名・答え・順位・数字・結論・本音やオチの一言。
- 説明・つなぎ・前置きの字幕は選ばない。多すぎると強調にならないので、項目1つにつき1つ程度、全体の3割までにする。
- 効果を言い切る言葉(「絶対治る」「痛くない」など)を含む字幕は選ばない。

選んだ字幕の番号(picks)と、それぞれを選んだ理由(reasons。picksと同じ順)を答えてください。
`.trim();

/** 10. 強調テロップにする字幕を選ぶ(0始まりの番号で返す)。 */
export const pickEmphasis = async (captions: string[]): Promise<{ index: number; reason: string }[]> => {
  if (captions.length === 0) return [];
  const result = await askJson({
    model: STEP_MODEL,
    label: "強調テロップ",
    parts: [{ text: EMPHASIS_PROMPT(captions) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        picks: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["picks", "reasons"],
    },
    parse: z.object({ picks: z.array(z.number().int()), reasons: z.array(z.string()) }),
  });
  const seen = new Set<number>();
  return result.picks.flatMap((pick, i) => {
    const index = pick - 1;
    if (index < 0 || index >= captions.length || seen.has(index)) return [];
    seen.add(index);
    return [{ index, reason: result.reasons[i] ?? "" }];
  });
};
