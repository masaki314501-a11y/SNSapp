import { z } from "zod";
import { bgmSchema, ctaSchema, hookSchema, mediaItemBaseSchema, sfxClipSchema, themeSchema } from "../../shared/schema";

// 動画全体の音声を文字起こしして字幕化するため、発話の区切りの数だけクリップができる。
// 上限は暴走防止のための目安であり、マーケティング用テンプレートのような固定枠ではない。
export const MIN_CLIPS = 1;
export const MAX_CLIPS = 40;

// 効果音(SE)は暴走防止のための目安の上限。
export const MAX_SFX_CLIPS = 30;

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
});

export type ClipProps = z.infer<typeof clipSchema>;
export type StandardVideoProps = z.infer<typeof standardVideoSchema>;
