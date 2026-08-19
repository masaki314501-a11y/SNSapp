import { z } from "zod";
import { ctaSchema, hookSchema, mediaItemBaseSchema, themeSchema } from "../../shared/schema";

export const MIN_CLIPS = 2;
export const MAX_CLIPS = 4;

export const clipSchema = mediaItemBaseSchema;

export const standardVideoSchema = z.object({
  hook: hookSchema,
  clips: z
    .array(clipSchema)
    .min(MIN_CLIPS)
    .max(MAX_CLIPS)
    .describe("本題パートを構成するクリップ(2〜4個)"),
  cta: ctaSchema,
  theme: themeSchema,
});

export type ClipProps = z.infer<typeof clipSchema>;
export type StandardVideoProps = z.infer<typeof standardVideoSchema>;
