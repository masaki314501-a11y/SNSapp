import { GoogleGenAI, Type, type Part, type Schema } from "@google/genai";
import { z } from "zod";
import type { FaceBox } from "@video/shared/schema";
import { runWithGeminiRateLimit } from "@/lib/gemini/rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "@/lib/gemini/geminiErrors";
import { waitForGeminiFileActive } from "@/lib/gemini/geminiFiles";
import { editExampleMediaPath, uploadExampleVideo, type EditExample } from "@/lib/gemini/editExamplesStore";
import { selectEditExamples } from "@/lib/gemini/editExampleSelection";

/**
 * 工程ごとの編集(編集マニュアルの1〜11)のうち、AIに頼む工程(3・6・8・10)。
 * まとめて全部を頼むと工程ごとの誤差が大きかったため、1回に1つのことだけを、短い指示文で頼む。
 * 工程9(テロップ入力)は、今ある文字起こし(transcribeCaptions)を使う。
 */

/** 判断のいる工程(3・8・10)のモデル。顔の位置(6)は軽いモデルで足りる。 */
const STEP_MODEL = process.env.GEMINI_STEP_MODEL || "gemini-pro-latest";
const FACE_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
/** 1回の答えを待つ時間。答えが詰まって返ってこないことがあるので、長く待たずに頼み直す。 */
const TIMEOUT_MS = 90_000;
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

/**
 * 手本(この投稿者の編集チームが作った動画)を見せる。手本から何をどう参考にするかは決まりにせず、AIに任せる。
 * 見せる手本は、今回の動画に近い物をAIが選ぶ(最大3本。近い物が無ければ見せない)。同じ動画の間は同じ手本を使い回し、
 * 手本の動画も1回だけアップロードして使い回す(料金と待ち時間を抑えるため、画質は低めで見せる)。
 */
export const EXAMPLES_INTRO = `
次は、この投稿者の編集チームが過去に作ったショート動画(手本)です。今回の動画に近い物を選んであります。
手本を見て、何をどう参考にするか(参考にしないことも含めて)は、あなたが判断してください。
ただし、手本に出てくる文言・題材・項目名は、今回の動画に持ち込まないでください。
`.trim();

const chosenExamples = new Map<string, { examples: EditExample[]; expiresAt: number }>();
const exampleUploads = new Map<string, { part: Part; expiresAt: number }>();

const examplesFor = async (ai: GoogleGenAI, absolutePath: string, mimeType: string): Promise<EditExample[]> => {
  const cached = chosenExamples.get(absolutePath);
  if (cached && cached.expiresAt > Date.now()) return cached.examples;
  const examples = await selectEditExamples(ai, await videoPart(ai, absolutePath, mimeType));
  chosenExamples.set(absolutePath, { examples, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return examples;
};

const examplePart = async (ai: GoogleGenAI, mediaPath: string, mimeType: string): Promise<Part> => {
  const cached = exampleUploads.get(mediaPath);
  if (cached && cached.expiresAt > Date.now()) return cached.part;
  const part = await uploadExampleVideo(ai, mediaPath, mimeType, [], "low");
  exampleUploads.set(mediaPath, { part, expiresAt: Date.now() + UPLOAD_REUSE_MS });
  return part;
};

/** 手本を見せる部分(手本が無ければ空)。完成動画を見せる。 */
const exampleParts = async (absolutePath: string, mimeType: string): Promise<Part[]> => {
  const ai = client();
  const examples = await examplesFor(ai, absolutePath, mimeType);
  if (examples.length === 0) return [];
  const parts: Part[] = [{ text: EXAMPLES_INTRO }];
  for (const [index, example] of examples.entries()) {
    parts.push({ text: `【手本${index + 1}「${example.label}」の完成動画】` });
    parts.push(await examplePart(ai, editExampleMediaPath(example, "correct")!, example.correctMimeType));
  }
  parts.push({ text: "【ここから、今回編集する動画の話】" });
  return parts;
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
      // 答えの形が崩れた・待っても返ってこない時も、頼み直す
      if ((error instanceof SyntaxError || (error instanceof Error && error.message === "Gemini API timeout")) && attempt < MAX_ATTEMPTS) continue;
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
   話の中に出てくる治療名・症状名を、話したとおりに1つ入れる。12文字を超える時だけ、意味の切れ目に「\\n」を1つ入れて2行にする。
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
  const examples = await exampleParts(input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "タイトルと枠",
    parts: [...examples, part, { text: OBJECTS_PROMPT }],
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
- ランキングや「〇選」のように項目を順に挙げていく動画では、項目名(順位・用語・治療名など、挙げていく物の名前)の
  字幕を、1つ目から最後まで全部選ぶ。項目の説明・答えの字幕は選ばない。
- それ以外の動画では、見ている人に一番残したい言葉が入った字幕(答え・数字・結論・本音やオチの一言)を、全体の3割までで選ぶ。
- 説明・つなぎ・前置き・締めのあいさつの字幕は選ばない。
- 効果を言い切る言葉(「絶対治る」「痛くない」など)を含む字幕は選ばない。

選んだ字幕の番号(picks)と、それぞれを選んだ理由(reasons。picksと同じ順)を答えてください。
`.trim();

/** 10. 強調テロップにする字幕を選ぶ(0始まりの番号で返す)。 */
export const pickEmphasis = async (input: {
  absolutePath: string;
  mimeType: string;
  captions: string[];
}): Promise<{ index: number; reason: string }[]> => {
  const { captions } = input;
  if (captions.length === 0) return [];
  const examples = await exampleParts(input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "強調テロップ",
    parts: [...examples, { text: EMPHASIS_PROMPT(captions) }],
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

/** 工程12(チェック)の誤字・脱字の確認の指示文。 */
export const PROOFREAD_PROMPT = (texts: { kind: "字幕" | "タイトル・枠の文字"; text: string }[]) => `
添付した動画の音声と、次の画面に出す文字を見比べて、誤字・脱字を探してください(番号: [種類] 文字)。
${texts.map((item, index) => `${index + 1}: [${item.kind}] ${item.text.replace(/\n/g, "")}`).join("\n")}

- [字幕]は話した言葉の書き起こし。聞き間違い(話している言葉と違う)・漢字の間違い・送り仮名の間違い・抜けている字・余計な字を探す。
  字幕は話した言葉を短くしてよいので、言い回しが違うだけ・言葉を省いているだけの物は誤りにしない。
- [タイトル・枠の文字]は話をまとめた言葉なので、話した言葉と違っていてよい。漢字・送り仮名の間違い、抜けている字・余計な字だけを探す。
- 専門用語・略語(DM・IVなど)は、話している言葉のとおりなら誤りにしない。
- 見つからなければ空の配列で答える。

誤りごとに、文字の番号(index)、誤りの部分(wrong)、正しい書き方(correct)、理由(reason)を書いてください。
`.trim();

/** 12. 画面に出す文字の誤字・脱字の候補を探す。 */
export const proofreadTexts = async (input: {
  absolutePath: string;
  mimeType: string;
  texts: { kind: "字幕" | "タイトル・枠の文字"; text: string }[];
}): Promise<{ text: string; wrong: string; correct: string; reason: string }[]> => {
  if (input.texts.length === 0) return [];
  const part = await videoPart(client(), input.absolutePath, input.mimeType);
  const result = await askJson({
    model: STEP_MODEL,
    label: "誤字・脱字の確認",
    parts: [part, { text: PROOFREAD_PROMPT(input.texts) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        issues: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              wrong: { type: Type.STRING },
              correct: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ["index", "wrong", "correct", "reason"],
          },
        },
      },
      required: ["issues"],
    },
    parse: z.object({
      issues: z.array(z.object({ index: z.number().int(), wrong: z.string(), correct: z.string(), reason: z.string() })),
    }),
  });
  return result.issues
    .filter((issue) => issue.index >= 1 && issue.index <= input.texts.length && issue.wrong !== issue.correct)
    .map((issue) => ({ text: input.texts[issue.index - 1].text, wrong: issue.wrong, correct: issue.correct, reason: issue.reason }));
};

/** 工程12(長さを収める)の指示文。 */
export const SHORTEN_PROMPT = (captions: { text: string; seconds: number }[], totalSeconds: number, targetSeconds: number) => `
次は、ショート動画の字幕を順に並べたものです(番号: 字幕 [その字幕の秒数])。今の長さは${totalSeconds.toFixed(1)}秒です。
${captions.map((caption, index) => `${index + 1}: ${caption.text.replace(/\n/g, "")} [${caption.seconds.toFixed(1)}秒]`).join("\n")}

この動画を${targetSeconds}秒以内に収めるため、外す字幕(その字幕の場面ごと外す)を選んでください。
- 外してよいのは、前置き・繰り返し・言い換え・話の本筋に関係ない脱線・締めのあいさつの重複。
- 外さないのは、動画のテーマを言う最初の一言・挙げていく項目(順位・用語・治療名など)とその答え・結論。
- 外す字幕の秒数の合計が、${(totalSeconds - targetSeconds).toFixed(1)}秒以上になるように選ぶ。外すと話がつながらなくなる所は外さない。

外す字幕の番号(removes)と、それぞれの理由(reasons。removesと同じ順)を答えてください。
`.trim();

/** 12. 長さを収めるために外す字幕を選ぶ(0始まりの番号で返す)。 */
export const pickRemovals = async (input: {
  absolutePath: string;
  mimeType: string;
  captions: { text: string; seconds: number }[];
  totalSeconds: number;
  targetSeconds: number;
}): Promise<{ index: number; reason: string }[]> => {
  const { captions, totalSeconds, targetSeconds } = input;
  const result = await askJson({
    model: STEP_MODEL,
    label: "長さを収める",
    parts: [{ text: SHORTEN_PROMPT(captions, totalSeconds, targetSeconds) }],
    schema: {
      type: Type.OBJECT,
      properties: {
        removes: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["removes", "reasons"],
    },
    parse: z.object({ removes: z.array(z.number().int()), reasons: z.array(z.string()) }),
  });
  const seen = new Set<number>();
  return result.removes.flatMap((pick, i) => {
    const index = pick - 1;
    if (index < 0 || index >= captions.length || seen.has(index)) return [];
    seen.add(index);
    return [{ index, reason: result.reasons[i] ?? "" }];
  });
};
