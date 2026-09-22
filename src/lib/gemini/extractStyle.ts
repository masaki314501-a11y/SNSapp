import { GoogleGenAI, MediaResolution, ThinkingLevel, Type, type Content } from "@google/genai";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { MISSING_API_KEY_MESSAGE, isDailyQuotaError, isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { waitForGeminiFileActive } from "./geminiFiles";
import { loadStyleFewShotContext } from "./styleExamplesStore";
import { extractedStyleSchema, type ExtractedStyle } from "./styleTypes";
import { recordGeminiDailyQuotaExceeded, recordGeminiUsage } from "./usageLog";
import { isGeminiMockEnabled } from "./mockMode";
import { computeExtractStyleCacheKey, getCachedExtractedStyle, setCachedExtractedStyle } from "./extractStyleCache";

export type { ExtractedStyle } from "./styleTypes";
export { extractedStyleSchema } from "./styleTypes";

const DEFAULT_MODEL = "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;
// 「テロップが最初に出る瞬間の動き」だけ見れば足りるため、動画は先頭のみをGeminiに解析させる
// (File API自体へのアップロードは全体を行うが、generateContent側で解析範囲を絞る)。
const VIDEO_ANALYSIS_END_OFFSET = "12s";

export type ExtractStyleInput =
  | { kind: "image"; imageBase64: string; mimeType: string; apiKeyOverride?: string }
  | { kind: "video"; absoluteVideoPath: string; mimeType: string; apiKeyOverride?: string };

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
添付した${subject}を見て、テロップ(字幕)のスタイルを5つ提案してください。

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

/** GEMINI_MOCK=1のときに返す固定のダミー結果(開発中の動作確認用)。 */
const MOCK_STYLE: ExtractedStyle = {
  primaryColor: "#FF3366",
  fontFamily: FONT_FAMILY_VALUES[0],
  captionPosition: CAPTION_POSITION_VALUES[0],
  captionStyle: CAPTION_STYLE_VALUES[0],
  captionAnimation: CAPTION_ANIMATION_VALUES[0],
};

/**
 * 参考画像/参考動画(競合の投稿など)からテロップに使う配色・フォント・配置位置・背景の付き方・
 * 出現演出をまとめて抽出する。動画の場合はGemini File API経由で渡すことで、静止画からは
 * 読み取れない「テロップがどう動いて出てくるか」も演出パターンの判断材料にできる。
 * フォント/背景の付き方/演出は実在しない値を当てさせるのではなく、こちらで用意した候補
 * (同梱済み・実装済みのもの)の中から一番近いものをGeminiに選ばせる分類タスクにしている。
 * フォールバックは持たない(呼び出し元でエラー表示し、既定値のまま使うかは利用者に委ねる)。
 */
export const extractStyle = async (input: ExtractStyleInput): Promise<ExtractedStyle> => {
  if (isGeminiMockEnabled()) {
    return MOCK_STYLE;
  }

  const cacheKey = await computeExtractStyleCacheKey(input);
  const cached = getCachedExtractedStyle(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = input.apiKeyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[extractStyle] GEMINI_API_KEYが未設定です(共有キーも自分のキーも無し)");
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input.kind);

  let uploadedFileName: string | undefined;
  type ContentPart =
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string }; videoMetadata: { endOffset: string } };
  const buildContentPart = async (): Promise<ContentPart> => {
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
    // テロップが最初に出る瞬間の動きだけ見れば足りるため、解析範囲を先頭のみに絞る
    // (動画が短ければGemini側で実際の長さに合わせて扱われる)。
    return {
      fileData: { fileUri: uploaded.uri, mimeType: input.mimeType },
      videoMetadata: { endOffset: VIDEO_ANALYSIS_END_OFFSET },
    };
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
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
              // 単純な分類・抽出タスクで深い思考は不要なため、内部の「思考」トークン消費を
              // 最小にする(Gemini 3系は完全な無効化はできず、MINIMALが下限)。
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Gemini API timeout")), GEMINI_TIMEOUT_MS);
          });
          return Promise.race([generatePromise, timeoutPromise]);
        });

        recordGeminiUsage("extractStyle", model, response.usageMetadata);

        const text = response.text;
        if (!text) {
          throw new Error("Gemini APIから空の応答が返されました");
        }

        const parsed = extractedStyleSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }
        const style = parsed.data as ExtractedStyle;
        setCachedExtractedStyle(cacheKey, style);
        return style;
      } catch (error) {
        lastError = error;
        if (isDailyQuotaError(error)) {
          recordGeminiDailyQuotaExceeded("extractStyle");
        }
        if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[extractStyle] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS}): ${
              error instanceof Error ? error.message : error
            }`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        console.error(
          `[extractStyle] リトライ上限(${MAX_ATTEMPTS}回)に到達、または再試行不可のエラーで中断します(試行${attempt}/${MAX_ATTEMPTS})`,
          error
        );
        throw toFriendlyGeminiError(error, Boolean(input.apiKeyOverride));
      }
    }
    throw toFriendlyGeminiError(lastError, Boolean(input.apiKeyOverride));
  } finally {
    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => {});
    }
    for (const name of fewShotUploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
