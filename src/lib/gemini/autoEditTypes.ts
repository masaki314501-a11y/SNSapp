import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";
import { SFX_PRESETS } from "@/components/editor/audioPresets";

/**
 * autoEditPlan.tsとautoEditJobs.tsの両方から使う型・スキーマ。extractStyle.ts/styleTypes.ts
 * と同じ理由(循環import回避)でこのファイルに切り出している。
 *
 * ここはGeminiの生の応答を受け取るためのスキーマなので、数値の範囲などはあえて緩くしている。
 * 1か所の値が範囲外なだけで編集案全体を捨てるのはもったいないため、範囲の丸め込みや不正な
 * 要素の除外はautoEditPlan.ts側で要素ごとに行う。
 */
const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

const rawOverlaySchema = z.object({
  text: z.string(),
  startOffsetSeconds: z.number().nullable().optional(),
  durationInSeconds: z.number().nullable().optional(),
  xPercent: z.number().nullable().optional(),
  yPercent: z.number().nullable().optional(),
  fontSizePx: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  strokeColor: z.string().nullable().optional(),
  backgroundColor: z.string().nullable().optional(),
  rotationDeg: z.number().nullable().optional(),
  animation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).nullable().optional(),
});

const rawClipSchema = z.object({
  /** 元動画上の開始・終了秒。Geminiが本人の動画を見て、使う区間を自由に切り出す。 */
  sourceStartSeconds: z.number(),
  sourceEndSeconds: z.number(),
  /** この区間で話している内容。字幕は編集画面で付けるかどうか決めるため、ここでは下書きとして保持する。 */
  speech: z.string().nullable().optional(),
  captionAnimation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).nullable().optional(),
  emphasisWords: z.array(z.string()).nullable().optional(),
  emphasisColor: z.string().nullable().optional(),
  zoom: z
    .object({
      scale: z.number(),
      style: z.enum(["punch", "slow"]).nullable().optional(),
      focusXPercent: z.number().nullable().optional(),
      focusYPercent: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  overlays: z.array(rawOverlaySchema).nullable().optional(),
  sfx: z
    .array(
      z.object({
        presetId: z.enum(SFX_PRESET_IDS as [string, ...string[]]),
        offsetSeconds: z.number().nullable().optional(),
      })
    )
    .nullable()
    .optional(),
  /** AIナレーションで読ませる文(元の声とは別に足す)。不要ならnull。 */
  narration: z.string().nullable().optional(),
});

export const rawAutoEditPlanSchema = z.object({
  /** 参考スクショ/動画から読み取った「編集の感じ」。UIに出して、何を手本にしたか確認できるようにする。 */
  referenceNotes: z.string().nullable().optional(),
  /** 「なぜこう編集したか」を短く。UIに表示してユーザーが受け入れ判断をしやすくするため。 */
  summary: z.string(),
  theme: z
    .object({
      primaryColor: z.string().nullable().optional(),
      fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]).nullable().optional(),
      captionPosition: z.enum(CAPTION_POSITION_VALUES as [string, ...string[]]).nullable().optional(),
      captionStyle: z.enum(CAPTION_STYLE_VALUES as [string, ...string[]]).nullable().optional(),
    })
    .nullable()
    .optional(),
  hook: z.object({ headline: z.string(), subline: z.string().nullable().optional() }).nullable().optional(),
  cta: z.object({ text: z.string() }).nullable().optional(),
  /** 動画全体に重ね続ける文字(参考投稿の上部タイトル等)。 */
  globalOverlays: z.array(rawOverlaySchema).nullable().optional(),
  clips: z.array(rawClipSchema),
});

export type RawAutoEditPlan = z.infer<typeof rawAutoEditPlanSchema>;
export type RawAutoEditClip = z.infer<typeof rawClipSchema>;
