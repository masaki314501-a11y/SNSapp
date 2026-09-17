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
 */
const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);
const SFX_PRESET_IDS = SFX_PRESETS.map((preset) => preset.id);

/**
 * Geminiには実在するクリップのindexで答えさせ(segmentIndex)、呼び出し元(autoEditPlan.ts)が
 * 元のsegment.keyへ変換してから返す。UUID文字列をそのまま出力させるより、範囲内の整数を
 * 選ばせる方がGeminiが値を取り違えにくい。
 */
export const autoEditSegmentSchema = z.object({
  segmentIndex: z.number().int().min(0),
  /** 演出に強弱をつけたい区間だけ上書きする。省略時は元のcaptionAnimation(既定演出)を維持する。 */
  captionAnimation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]).optional(),
  /** このクリップをAIナレーションで読み上げるべきか(フックや結論など、声で強調したい箇所のみtrue)。 */
  addNarration: z.boolean(),
  /** このクリップの開始時点で鳴らす効果音。無ければnull。SFX_PRESETSの実在idのみ。 */
  sfxPresetId: z.enum(SFX_PRESET_IDS as [string, ...string[]]).nullable(),
});

export const autoEditPlanSchema = z.object({
  segments: z.array(autoEditSegmentSchema),
  /**
   * hasStyleReference=falseのとき(参考画像/動画が無かった場合)のみGeminiに埋めさせる。
   * trueのときは呼び出し側でこの欄を無視する(既にextractStyleで決まっているため)。
   */
  theme: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]).optional(),
      captionPosition: z.enum(CAPTION_POSITION_VALUES as [string, ...string[]]).optional(),
      captionStyle: z.enum(CAPTION_STYLE_VALUES as [string, ...string[]]).optional(),
    })
    .optional(),
  /** 「なぜこう編集したか」を1〜2文で。UIに表示してユーザーが受け入れ判断をしやすくするため。 */
  summary: z.string(),
});

export type AutoEditPlan = z.infer<typeof autoEditPlanSchema>;
