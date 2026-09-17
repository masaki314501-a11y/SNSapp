import { z } from "zod";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
} from "@video/shared/schema";

/**
 * extractStyle.tsとstyleExamplesStore.tsの両方から使う型・スキーマ。
 * 循環import(extractStyle⇄styleExamplesStore)を避けるためこのファイルに切り出している。
 */
export type ExtractedStyle = {
  primaryColor: string;
  fontFamily: (typeof CAPTION_FONT_FAMILY_OPTIONS)[number]["value"];
  captionPosition: (typeof CAPTION_POSITION_OPTIONS)[number]["value"];
  captionStyle: (typeof CAPTION_STYLE_OPTIONS)[number]["value"];
  captionAnimation: (typeof CAPTION_ANIMATION_OPTIONS)[number]["value"];
};

const FONT_FAMILY_VALUES = CAPTION_FONT_FAMILY_OPTIONS.map((option) => option.value);
const CAPTION_POSITION_VALUES = CAPTION_POSITION_OPTIONS.map((option) => option.value);
const CAPTION_STYLE_VALUES = CAPTION_STYLE_OPTIONS.map((option) => option.value);
const CAPTION_ANIMATION_VALUES = CAPTION_ANIMATION_OPTIONS.map((option) => option.value);

/** extractStyleの応答および登録済み正解データ(styleExamplesStore)の両方で使う検証スキーマ。 */
export const extractedStyleSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(FONT_FAMILY_VALUES as [string, ...string[]]),
  captionPosition: z.enum(CAPTION_POSITION_VALUES as [string, ...string[]]),
  captionStyle: z.enum(CAPTION_STYLE_VALUES as [string, ...string[]]),
  captionAnimation: z.enum(CAPTION_ANIMATION_VALUES as [string, ...string[]]),
});
