import Groq from "groq-sdk";
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
import { loadEditFewShotTextContext } from "../gemini/editExamplesStore";
import { autoEditPlanSchema } from "../gemini/autoEditTypes";
import { isGeminiMockEnabled } from "../gemini/mockMode";
import { createGroqClient } from "./groqClient";
import { GroqTimeoutError, isRetryableGroqError, toFriendlyGroqError } from "./groqErrors";
import { runWithGroqTextRateLimit } from "./rateLimiter";
import { recordGroqUsage } from "./usageLog";

/**
 * 自動編集(バズる動画)の提案生成。docs/gemini-multi-provider-offload/README.mdの方針案1に
 * 基づき、Geminiから移行した(入力がテロップ文言+尺のテキストのみで、Groqの無料枠
 * (テキスト生成RPD 1,000)にそのまま収まるため)。管理者の共有GROQ_API_KEYのみで動かし、
 * BYOK(各自のAPIキー)には対応しない。
 */

const DEFAULT_MODEL = "openai/gpt-oss-20b";
const GROQ_BASE_TIMEOUT_MS = 60_000;
const GROQ_TIMEOUT_PER_SEGMENT_MS = 2_000;
const GROQ_MAX_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 4_000;

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
    ? "配色・フォント・テロップ位置・背景の付き方は既に参考画像/動画から決定済みです。themeフィールドはnullにしてください。"
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
演出・AIナレーション・効果音のいずれかを追加すべきクリップだけを選んで提案してください。

## クリップ一覧(index. "テロップ" (尺))
${segmentsList}

## 出力について(重要)
segmentsには、**演出・ナレーション・効果音のいずれか1つでも追加するクリップだけ**を
含めてください。何も追加しないクリップは含めなくてよく、全クリップ分を列挙する必要は
ありません(クリップ数が多い動画では、そのほうが応答が速く軽くなります)。

## あなたが決めてよいこと
1. captionAnimation: 特に強調したい区間だけ演出を上書きする(不要ならnull)。候補:
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
`.trim();
};

// GroqのJSON構造化出力(strict mode)は標準のJSON Schemaに従い、nullを許可するフィールドは
// type配列("string"|"null")で表現し、全フィールドをrequiredに含める必要がある
// (省略可能フィールドという概念が無い。console.groq.com/docs/structured-outputsで確認)。
const responseSchema = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          segmentIndex: { type: "integer", description: "クリップ一覧のindex(0始まり)" },
          captionAnimation: {
            type: ["string", "null"],
            enum: [...CAPTION_ANIMATION_VALUES, null],
            description: "このクリップだけ演出を上書きする場合のみ指定。しない場合はnull",
          },
          addNarration: { type: "boolean" },
          sfxPresetId: {
            type: ["string", "null"],
            enum: [...SFX_PRESET_IDS, null],
          },
        },
        required: ["segmentIndex", "captionAnimation", "addNarration", "sfxPresetId"],
        additionalProperties: false,
      },
    },
    theme: {
      type: ["object", "null"],
      properties: {
        primaryColor: { type: "string", description: "#RRGGBB形式" },
        fontFamily: { type: "string", enum: FONT_FAMILY_VALUES },
        captionPosition: { type: "string", enum: CAPTION_POSITION_VALUES },
        captionStyle: { type: "string", enum: CAPTION_STYLE_VALUES },
      },
      required: ["primaryColor", "fontFamily", "captionPosition", "captionStyle"],
      additionalProperties: false,
    },
    summary: { type: "string" },
  },
  required: ["segments", "theme", "summary"],
  additionalProperties: false,
} as const;

/**
 * 文字起こし済みのクリップ一覧から、自動編集(演出上書き・AIナレーション追加・効果音配置)の
 * 提案を生成する。コスト抑制のため、ユーザー自身の動画は一切アップロードせず、テロップ文言と
 * 尺(既に手元にある情報)だけをテキストで渡す。登録済みの編集例(editExamplesStore)があれば
 * few-shotとして「良い編集の実例」を先頭に差し込む(digest未生成のものはスキップされる)。
 * フォールバックは持たない(失敗時は呼び出し元でエラー表示し、常にスキップできるようにする)。
 */
export const generateAutoEditPlan = async (input: AutoEditPlanInput): Promise<AutoEditPlan> => {
  if (isGeminiMockEnabled()) {
    return {
      segments: input.segments.map((segment) => ({
        key: segment.key,
        addNarration: false,
        sfxPresetId: null,
      })),
      summary: "(モック提案)",
    };
  }

  const groq = createGroqClient();
  const model = process.env.GROQ_TEXT_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input);
  const timeoutMs = Math.min(
    GROQ_MAX_TIMEOUT_MS,
    GROQ_BASE_TIMEOUT_MS + input.segments.length * GROQ_TIMEOUT_PER_SEGMENT_MS
  );

  const fewShotParts = await loadEditFewShotTextContext();
  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    ...fewShotParts.map((text): Groq.Chat.ChatCompletionMessageParam => ({ role: "user", content: text })),
    { role: "user", content: prompt },
  ];

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await runWithGroqTextRateLimit(() => {
        const completionPromise = groq.chat.completions.create({
          model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: { name: "auto_edit_plan", strict: true, schema: responseSchema },
          },
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new GroqTimeoutError("Groq API timeout")), timeoutMs);
        });
        return Promise.race([completionPromise, timeoutPromise]);
      });

      const usage = response.usage;
      recordGroqUsage(
        "autoEditPlan",
        model,
        `tokens(prompt/completion/total)=${usage?.prompt_tokens ?? "?"}/${usage?.completion_tokens ?? "?"}/${usage?.total_tokens ?? "?"}`
      );

      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new Error("Groq APIから空の応答が返されました");
      }

      const raw = JSON.parse(text) as { theme?: unknown };
      if (raw.theme === null) {
        // strict modeでは省略できず必ずnullが返るため、zod検証の前にundefinedへ正規化する。
        raw.theme = undefined;
      }

      const parsed = autoEditPlanSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Groq応答のスキーマ検証に失敗: ${parsed.error.message}`);
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
      if (isRetryableGroqError(error) && attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_BASE_DELAY_MS * attempt;
        console.warn(
          `[autoEditPlan(groq)] Groqが混雑しているため${delayMs}ms後に再試行します(試行${attempt}/${MAX_ATTEMPTS}): ${
            error instanceof Error ? error.message : error
          }`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      console.error(
        `[autoEditPlan(groq)] リトライ上限(${MAX_ATTEMPTS}回)に到達、または再試行不可のエラーで中断します(試行${attempt}/${MAX_ATTEMPTS})`,
        error
      );
      throw toFriendlyGroqError(error);
    }
  }
  throw toFriendlyGroqError(lastError);
};
