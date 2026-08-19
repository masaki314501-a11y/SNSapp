import { z } from "zod";
import { ctaSchema, hookSchema, mediaItemBaseSchema, themeSchema } from "../../shared/schema";

export const MIN_ITEMS = 3;
export const MAX_ITEMS = 5;

export const rankingItemSchema = mediaItemBaseSchema.extend({
  title: z.string().describe("ランキング項目のタイトル(例: 商品名)"),
});

export const rankingVideoSchema = z.object({
  hook: hookSchema,
  items: z
    .array(rankingItemSchema)
    .min(MIN_ITEMS)
    .max(MAX_ITEMS)
    .describe(
      "ランキング項目。配列の先頭から順にカウントダウン表示され、最後の要素が1位になる"
    ),
  cta: ctaSchema,
  theme: themeSchema,
});

export type RankingItemProps = z.infer<typeof rankingItemSchema>;
export type RankingVideoProps = z.infer<typeof rankingVideoSchema>;
