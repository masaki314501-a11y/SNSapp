import { z } from "zod";
import {
  bgmSchema,
  ctaSchema,
  hookSchema,
  mediaItemBaseSchema,
  imageOverlaySchema,
  sfxClipSchema,
  textOverlaySchema,
  themeSchema,
} from "../../shared/schema";

// 動画全体の音声を文字起こしして字幕化するため、発話の区切りの数だけクリップができる。
// 上限は暴走防止のための目安であり、マーケティング用テンプレートのような固定枠ではない。
// 編集の精度を優先し、自動編集が細かく切っても足りるよう実質無制限の大きさにしている。
export const MIN_CLIPS = 1;
export const MAX_CLIPS = 120;

// 効果音(SE)とAIナレーションの合計の上限。暴走防止の目安で、全クリップにナレーション+効果音を
// 複数付けても届かない大きさにしている(以前の30件では自動編集の途中で打ち切られていた)。
export const MAX_SFX_CLIPS = 400;

export const clipSchema = mediaItemBaseSchema;

export const standardVideoSchema = z.object({
  hook: hookSchema.optional(),
  clips: z
    .array(clipSchema)
    .min(MIN_CLIPS)
    .max(MAX_CLIPS)
    .describe("動画全体を音声の区切りごとに分割したクリップ"),
  cta: ctaSchema.optional(),
  theme: themeSchema,
  sfx: z.array(sfxClipSchema).max(MAX_SFX_CLIPS).default([]).describe("効果音(SE)"),
  bgm: bgmSchema.optional().describe("背景音楽(全体に1つ、ループ再生)"),
  // 参考投稿によくある「動画の上部にずっと出ているタイトル」など、カットをまたいで表示する文字。
  // startOffsetSeconds/durationInSecondsは動画全体の先頭からの秒数。
  globalOverlays: z.array(textOverlaySchema).max(12).optional().describe("動画全体に重ねる文字(タイトル等)"),
  globalImages: z.array(imageOverlaySchema).max(12).optional().describe("動画全体に重ねる画像(ロゴ等)"),
});

export type ClipProps = z.infer<typeof clipSchema>;
export type StandardVideoProps = z.infer<typeof standardVideoSchema>;
