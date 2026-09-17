import { GoogleGenAI, Type, type Content } from "@google/genai";
import type {
  CaptionAnimation,
  CaptionFontFamily,
  CaptionPosition,
  CaptionStyle,
} from "@video/shared/schema";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";
import { runWithGeminiRateLimit } from "./rateLimiter";
import { isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";
import { loadEditFewShotContext } from "./editExamplesStore";
import { autoEditPlanSchema } from "./autoEditTypes";

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 8_000;

/** ナレーション自動生成の上限。TTSは1日あたりの上限が一番壊れやすい資源のため、
 * プロンプト指示だけでなくサーバー側でも切り詰める(二重の歯止め)。 */
export const MAX_AUTO_NARRATION_SEGMENTS = 5;

export type AutoEditPlanInput = {
  segments: { key: string; caption: string; durationInSeconds: number }[];
  theme: {
    primaryColor: string;
    fontFamily: CaptionFontFamily;
    captionPosition: CaptionPosition;
    captionStyle: CaptionStyle;
    captionAnimation: CaptionAnimation;
  };
  /** 参考画像/動画からのスタイル抽出が既に成功しているか。trueならtheme欄の判断は不要。 */
  hasStyleReference: boolean;
};

export type AutoEditSegmentPlan = {
  key: string;
  captionAnimation?: CaptionAnimation;
  addNarration: boolean;
  sfxPresetId: string | null;
};

export type AutoEditPlan = {
  segments: AutoEditSegmentPlan[];
  theme?: {
    primaryColor?: string;
    fontFamily?: CaptionFontFamily;
    captionPosition?: CaptionPosition;
    captionStyle?: CaptionStyle;
  };
  summary: string;
};

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

const captionAnimationHints = CAPTION_ANIMATION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const fontFamilyHints = CAPTION_FONT_FAMILY_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionPositionHints = CAPTION_POSITION_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const captionStyleHints = CAPTION_STYLE_OPTIONS.map((o) => `- ${o.value}: ${o.label}`).join("\n");
const sfxPresetHints = SFX_PRESETS.map((p) => `- ${p.id}: ${p.label}`).join("\n");

const buildPrompt = (input: AutoEditPlanInput): string => {
  const segmentsList = input.segments
    .map((s, i) => `${i}. "${s.caption || "(テロップ無し)"}" (${s.durationInSeconds.toFixed(1)}秒)`)
    .join("\n");

  const themeSection = input.hasStyleReference
    ? "配色・フォント・テロップ位置・背景の付き方は既に参考画像/動画から決定済みです。themeフィールドは省略してください。"
    : `参考画像/動画が無いため、配色・フォント・テロップ位置・背景の付き方もあなたが決めてください。
候補一覧(候補にない値は絶対に使わないこと):
fontFamily:
${fontFamilyHints}
captionPosition:
${captionPositionHints}
captionStyle:
${captionStyleHints}`;

  return `
あなたはショート動画(9:16)の編集ディレクターです。以下は既にカット・文字起こし済みの
クリップ一覧(再生順)です。この動画が「バズる(拡散される)」可能性を高めるため、
各クリップに対して演出・AIナレーション・効果音の追加を提案してください。

## クリップ一覧(index. "テロップ" (尺))
${segmentsList}

## あなたが決めてよいこと
1. captionAnimation: 特に強調したい区間だけ演出を上書きする(省略可)。候補:
${captionAnimationHints}
2. addNarration: そのクリップをAIナレーション(読み上げ音声)で強調すべきか。
   フックとなる冒頭や結論など、声で押したい箇所だけtrueにしてください。
   **合計で最大${MAX_AUTO_NARRATION_SEGMENTS}クリップまで**です(TTSの利用上限があるため)。
3. sfxPresetId: そのクリップの開始時点で鳴らす効果音。候補:
${sfxPresetHints}
   付けない場合はnullにしてください。架空のidは絶対に使わないこと。

## あなたが決めてはいけないこと(必ず守ること)
- クリップの並び替え・トリミング・削除・分割は一切行わない
- テロップの文言は書き換えない
- BGMは提案しない(選択肢が用意されていないため)

${themeSection}

summaryには、なぜこの構成にしたのかを日本語1〜2文で書いてください。

JSON以外の文字列は出力しないでください。
`.trim();
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          segmentIndex: { type: Type.INTEGER, description: "クリップ一覧のindex(0始まり)" },
          captionAnimation: {
            type: Type.STRING,
            format: "enum",
            enum: CAPTION_ANIMATION_VALUES,
            nullable: true,
            description: "このクリップだけ演出を上書きする場合のみ指定",
          },
          addNarration: { type: Type.BOOLEAN },
          sfxPresetId: {
            type: Type.STRING,
            format: "enum",
            enum: SFX_PRESET_IDS,
            nullable: true,
          },
        },
        required: ["segmentIndex", "addNarration", "sfxPresetId"],
      },
    },
    theme: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        primaryColor: { type: Type.STRING, description: "#RRGGBB形式" },
        fontFamily: { type: Type.STRING, format: "enum", enum: FONT_FAMILY_VALUES },
        captionPosition: { type: Type.STRING, format: "enum", enum: CAPTION_POSITION_VALUES },
        captionStyle: { type: Type.STRING, format: "enum", enum: CAPTION_STYLE_VALUES },
      },
    },
    summary: { type: Type.STRING },
  },
  required: ["segments", "summary"],
} as const;

/**
 * 文字起こし済みのクリップ一覧から、自動編集(演出上書き・AIナレーション追加・効果音配置)の
 * 提案を生成する。コスト抑制のため、ユーザー自身の動画は一切アップロードせず、テロップ文言と
 * 尺(既に手元にある情報)だけをテキストで渡す。登録済みの編集例(editExamplesStore)があれば
 * few-shotとして「良い編集の実例」を先頭に差し込む。
 * フォールバックは持たない(失敗時は呼び出し元でエラー表示し、常にスキップできるようにする)。
 */
export const generateAutoEditPlan = async (input: AutoEditPlanInput): Promise<AutoEditPlan> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが未設定です");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input);

  let fewShotUploadedFileNames: string[] = [];
  try {
    const fewShot = await loadEditFewShotContext(ai);
    fewShotUploadedFileNames = fewShot.uploadedFileNames;
    const contents: Content[] = [...fewShot.contents, { role: "user", parts: [{ text: prompt }] }];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await runWithGeminiRateLimit(() => {
          const generatePromise = ai.models.generateContent({
            model,
            contents,
            config: { responseMimeType: "application/json", responseSchema },
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

        const parsed = autoEditPlanSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          throw new Error(`Gemini応答のスキーマ検証に失敗: ${parsed.error.message}`);
        }

        // segmentIndexは実在するクリップの範囲に限る。1件のズレで全体を失敗させない。
        const segments: AutoEditSegmentPlan[] = [];
        for (const s of parsed.data.segments) {
          const segment = input.segments[s.segmentIndex];
          if (!segment) continue;
          segments.push({
            key: segment.key,
            captionAnimation: (s.captionAnimation ?? undefined) as CaptionAnimation | undefined,
            addNarration: s.addNarration,
            sfxPresetId: s.sfxPresetId,
          });
        }

        return {
          segments,
          theme: input.hasStyleReference ? undefined : (parsed.data.theme as AutoEditPlan["theme"]),
          summary: parsed.data.summary,
        };
      } catch (error) {
        lastError = error;
        if (isRetryableApiError(error) && attempt < MAX_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * attempt;
          console.warn(
            `[autoEditPlan] Geminiが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw toFriendlyGeminiError(error);
      }
    }
    throw toFriendlyGeminiError(lastError);
  } finally {
    for (const name of fewShotUploadedFileNames) {
      await ai.files.delete({ name }).catch(() => {});
    }
  }
};
