import { GoogleGenAI, MediaResolution, Type, type Content } from "@google/genai";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { loadStyleFewShotContext } from "./styleExamplesStore";
import { extractedStyleSchema, type ExtractedStyle } from "./styleTypes";

export type { ExtractedStyle } from "./styleTypes";
export { extractedStyleSchema } from "./styleTypes";

/**
 * スクショや参考動画から「編集の感じ」を読み取るのは、細い縁取りと影の違い・ゴシックと丸ゴの
 * 違いといった細部の見極めが肝なので、自動編集と同じくProモデルを既定にする。
 * 課金移行前はflash-liteで動かしており、フォントや背景の付き方の判定が外れやすかった。
 * GEMINI_MODELと分けている理由はautoEditPlan.tsと同じ。
 */
const DEFAULT_MODEL = "gemini-pro-latest";
/** Proモデルは考えてから答えるぶん応答が遅く、参考動画だと60秒では足りないことがあるため延ばす。 */
const GEMINI_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

export type ExtractStyleInput =
  | { kind: "image"; imageBase64: string; mimeType: string }
  | { kind: "video"; absoluteVideoPath: string; mimeType: string };

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);

// Geminiにフォントの「見た目の系統」を判断してもらうため、各候補のラベル(和名)を
// そのままヒントとして渡す。実在のフォント名を当てさせるのではなく、用意した候補の
// 中から一番近い系統を選ばせる分類タスクにすることで、実際に同梱していないフォントを
// 誤って指定されることを防ぐ。
const fontFamilyHints = CAPTION_FONT_FAMILY_OPTIONS.map(
  (option) => `- ${option.value}: ${option.label}`
).join("\n");
const captionStyleHints = CAPTION_STYLE_OPTIONS.map((option) => `- ${option.value}: ${option.label}`).join("\n");
const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map(
  (option) => `- ${option.value}: ${option.label}`
).join("\n");

const buildPrompt = (kind: "image" | "video"): string => {
  const subject = kind === "video" ? "動画" : "画像(動画のスクリーンショットや参考画像)";
  const animationNote =
    kind === "video"
      ? "動画内でテロップが最初に表示される瞬間の動き(スライド・拡大・フェード等)をよく観察して判断してください。"
      : "静止画のためテロップの動きそのものは分からないので、テロップの見た目・縁取り・影の付き方などから最も自然に合いそうなものを推測してください。";

  return `
あなたはショート動画の編集者です。添付した${subject}を見て、この投稿者の「編集の感じ」
(テロップのデザインの癖)をできるだけ忠実に再現できるよう、テロップ(字幕)のスタイルを5つ判定してください。

判定の前に、次の点をよく観察してください(観察内容は出力に含めない)。
- テロップの文字そのもの: 太さ(極太/太/普通)、角ばっているか丸みがあるか、手書き・ポップ体・明朝のような癖があるか
- 文字の装飾: 縁取りの有無と太さ・色、影の有無、文字の後ろに帯や座布団(背景の図形)があるか
- 色の使い方: 文字色・縁取り色・帯の色のうち、どれが一番その投稿者らしい「差し色」か
- 配置: 顔や被写体を避けてどこに置いているか、画面の安全領域(上下のUIに隠れない範囲)の中のどこか

1. primaryColor: テロップに重ねて使うのに適したアクセントカラーを1色。${subject}内で印象的に
   使われている色、またはテロップの背景色として視認性が高くなりそうな色を選んでください。
   #RRGGBB形式の16進数コード。

2. fontFamily: ${subject}内の文字(テロップ・タイトル・ロゴ等)の雰囲気に一番近いものを、
   以下の候補から1つだけ選んでください(候補にない実在のフォント名を答えないこと)。
${fontFamilyHints}

3. captionPosition: ${subject}内でテロップ/主要なテキストが画面のどのあたりに配置されているか。
   はっきりしない場合は、画面内の余白(顔や被写体を避けている位置)から妥当な位置を推測して
   "top"(上部) / "middle"(中央) / "bottom"(下部) のいずれかで答えてください。

4. captionStyle: テロップの背景の付き方。以下の候補から1つだけ選んでください。
${captionStyleHints}

5. captionAnimation: テロップが表示される際の演出パターン。以下の候補から1つだけ選んでください。
${animationNote}
${captionAnimationHints}

JSON以外の文字列は出力しないでください。
`.trim();
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    primaryColor: {
      type: Type.STRING,
      description: "テロップに使うアクセントカラー。#RRGGBB形式の16進数コード。",
    },
    fontFamily: {
      type: Type.STRING,
      format: "enum",
      enum: FONT_FAMILY_VALUES,
      description: "画像/動画の雰囲気に最も近いフォントの系統(候補一覧から1つ)。",
    },
    captionPosition: {
      type: Type.STRING,
      format: "enum",
      enum: CAPTION_POSITION_VALUES,
      description: "テロップを配置する画面上の位置。",
    },
    captionStyle: {
      type: Type.STRING,
      format: "enum",
      enum: CAPTION_STYLE_VALUES,
      description: "テロップの背景の付き方(候補一覧から1つ)。",
    },
    captionAnimation: {
      type: Type.STRING,
      format: "enum",
      enum: CAPTION_ANIMATION_VALUES,
      description: "テロップが表示される際の演出パターン(候補一覧から1つ)。",
    },
  },
  required: ["primaryColor", "fontFamily", "captionPosition", "captionStyle", "captionAnimation"],
} as const;

/**
 * 参考画像/参考動画(競合の投稿など)からテロップに使う配色・フォント・配置位置・背景の付き方・
 * 出現演出をまとめて抽出する。動画の場合はGemini File API経由で渡すことで、静止画からは
 * 読み取れない「テロップがどう動いて出てくるか」も演出パターンの判断材料にできる。
 * フォント/背景の付き方/演出は実在しない値を当てさせるのではなく、こちらで用意した候補
 * (同梱済み・実装済みのもの)の中から一番近いものをGeminiに選ばせる分類タスクにしている。
 * フォールバックは持たない(呼び出し元でエラー表示し、既定値のまま使うかは利用者に委ねる)。
 */
export const extractStyle = async (input: ExtractStyleInput): Promise<ExtractedStyle> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_STYLE_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input.kind);

  let uploadedFileName: string | undefined;
  const buildContentPart = async (): Promise<{ inlineData: { mimeType: string; data: string } } | { fileData: { fileUri: string; mimeType: string } }> => {
    if (input.kind === "image") {
      return { inlineData: { mimeType: input.mimeType, data: input.imageBase64 } };
    }
    const uploaded = await ai.files.upload({
      file: input.absoluteVideoPath,
      config: { mimeType: input.mimeType },
    });
    if (!uploaded.name || !uploaded.uri) {
      throw new Error("参考動画のアップロードに失敗しました");
    }
    uploadedFileName = uploaded.name;
    await waitForGeminiFileActive(ai, uploaded.name);
    return { fileData: { fileUri: uploaded.uri, mimeType: input.mimeType } };
  };

  let fewShotUploadedFileNames: string[] = [];
  try {
    const contentPart = await buildContentPart();
    // 登録済みの正解データ(styleExamplesStore)をfew-shot例として先頭に付け、
    // 実際の抽出対象を最後のユーザーターンとして渡す。登録が無ければ従来通り単発の依頼になる。
    const fewShot = await loadStyleFewShotContext(ai);
    fewShotUploadedFileNames = fewShot.uploadedFileNames;
    const contents: Content[] = [
      ...fewShot.contents,
      { role: "user", parts: [contentPart, { text: prompt }] },
    ];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() => {
          const generatePromise = ai.models.generateContent({
            model,
            contents,
            config: {
              responseMimeType: "application/json",
              responseSchema,
              // スクショは縁取りの太さやフォントの系統など細部の見極めが判定の決め手になるため、
              // 画像のときだけ高解像度で読ませる(画像1枚ぶんのトークン増は小さい)。動画は
              // 本数×尺でトークンが膨らむため既定の解像度のままにする。
              ...(input.kind === "image" ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH } : {}),
            },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
          });
          return Promise.race([generatePromise, timeoutPromise]);
        });

        const text = response.text;
        if (!text) {
          throw new Error("Gemini APIから空の応答が返されました");
        }

        const parsed = extractedStyleSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }
        return parsed.data as ExtractedStyle;
      } catch (error) {
        lastError = error;
        if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[extractStyle] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw toFriendlyGeminiError(error);
      }
    }
    throw toFriendlyGeminiError(lastError);
  } finally {
    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => {});
    }
    for (const name of fewShotUploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
