import type { z } from "zod";
import { standardVideoSchema, MIN_CLIPS, MAX_CLIPS } from "./standard/schema";

/**
 * テンプレートのメタ情報とzodスキーマのみを持つレジストリ。
 * Reactコンポーネントやフォント読み込み(font.ts)を一切importしないため、
 * Node.jsのAPIルート(Route Handler)から安全に読み込める。
 * 実際の描画に使うコンポーネントは clientRegistry.tsx を参照。
 *
 * テンプレートは「フック(0-3秒)→本題(3-20秒)→CTA(20-25秒)」構成の
 * standard のみ。テンプレート選択UIは持たない。
 */
export const templateRegistry = {
  standard: {
    compositionId: "Standard",
    label: "フック→本題→CTA",
    description: `結論を先出しするフック、クリップ${MIN_CLIPS}〜${MAX_CLIPS}個をつなぐ本題、一言CTAで構成するテンプレート`,
    schema: standardVideoSchema,
  },
} as const;

export type TemplateId = keyof typeof templateRegistry;

export const TEMPLATE_IDS = Object.keys(templateRegistry) as TemplateId[];

export type TemplatePropsMap = {
  standard: z.infer<typeof standardVideoSchema>;
};

export const isTemplateId = (value: string): value is TemplateId =>
  Object.prototype.hasOwnProperty.call(templateRegistry, value);
