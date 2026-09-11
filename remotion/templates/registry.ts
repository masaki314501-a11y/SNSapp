import type { z } from "zod";
import { standardVideoSchema, MIN_CLIPS, MAX_CLIPS } from "./standard/schema";

/**
 * テンプレートのメタ情報とzodスキーマのみを持つレジストリ。
 * Reactコンポーネントやフォント読み込み(font.ts)を一切importしないため、
 * Node.jsのAPIルート(Route Handler)から安全に読み込める。
 * 実際の描画に使うコンポーネントは clientRegistry.tsx を参照。
 *
 * テンプレートは動画の音声を発話の区切りごとに字幕化する standard のみ。
 * テンプレート選択UIは持たない。
 */
export const templateRegistry = {
  standard: {
    compositionId: "Standard",
    label: "音声字幕",
    description: `動画の音声を発話の区切りごとに文字起こしし、テロップとして重ねるテンプレート(クリップ${MIN_CLIPS}〜${MAX_CLIPS}個)`,
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
