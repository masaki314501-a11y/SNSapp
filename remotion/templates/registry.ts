import type { z } from "zod";
import { standardVideoSchema, MIN_CLIPS, MAX_CLIPS } from "./standard/schema";
import { rankingVideoSchema, MIN_ITEMS, MAX_ITEMS } from "./ranking/schema";

/**
 * テンプレートのメタ情報とzodスキーマのみを持つレジストリ。
 * Reactコンポーネントやフォント読み込み(font.ts)を一切importしないため、
 * Node.jsのAPIルート(Route Handler)から安全に読み込める。
 * 実際の描画に使うコンポーネントは clientRegistry.tsx を参照。
 */
export const templateRegistry = {
  standard: {
    compositionId: "Standard",
    label: "標準(フック→本題→CTA)",
    description: `結論を先出しするフック、クリップ${MIN_CLIPS}〜${MAX_CLIPS}個をつなぐ本題、一言CTAで構成する基本テンプレート`,
    schema: standardVideoSchema,
  },
  ranking: {
    compositionId: "Ranking",
    label: "ランキング形式",
    description: `フック→ランキング項目${MIN_ITEMS}〜${MAX_ITEMS}個をカウントダウン表示→CTAで構成するテンプレート`,
    schema: rankingVideoSchema,
  },
} as const;

export type TemplateId = keyof typeof templateRegistry;

export const TEMPLATE_IDS = Object.keys(templateRegistry) as TemplateId[];

export type TemplatePropsMap = {
  standard: z.infer<typeof standardVideoSchema>;
  ranking: z.infer<typeof rankingVideoSchema>;
};

export const isTemplateId = (value: string): value is TemplateId =>
  Object.prototype.hasOwnProperty.call(templateRegistry, value);
