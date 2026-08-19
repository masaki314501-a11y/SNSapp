import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { DEFAULT_CLIP_DURATION_IN_SECONDS } from "./constants";

// "remotion" / "@remotion/google-fonts" 等はReactのクライアント実行を前提にしており、
// スキーマ定義(Node.jsのAPIルートからも読み込まれる)に混ぜるとRSC環境で例外になる。
// そのためフォント名はここでは文字列リテラルとして持つ(実際の読み込みは font.ts が担う)。
export const DEFAULT_FONT_FAMILY = '"Noto Sans JP", "Hiragino Sans", sans-serif';

export const hookSchema = z.object({
  headline: z.string().describe("結論・数字を先出しするメインテロップ(0-3秒)"),
  subline: z.string().optional().describe("補足テロップ(任意)"),
});

export const ctaSchema = z.object({
  text: z.string().default("詳しくはプロフィールへ"),
});

export const themeSchema = z.object({
  primaryColor: zColor().default("#FF3366"),
  fontFamily: z.string().default(DEFAULT_FONT_FAMILY),
});

export const captionAnimationSchema = z
  .enum(["slide-up", "fade", "pop", "zoom-in"])
  .default("slide-up")
  .describe("テロップの出現アニメーション");

export type CaptionAnimation = z.infer<typeof captionAnimationSchema>;

export const CAPTION_ANIMATION_OPTIONS: {
  value: CaptionAnimation;
  label: string;
}[] = [
  { value: "slide-up", label: "下からスライドイン" },
  { value: "fade", label: "フェードイン" },
  { value: "pop", label: "ポップイン(拡大)" },
  { value: "zoom-in", label: "ズームイン(縮小)" },
];

/**
 * 動画/画像+テロップで構成されるカットの共通フィールド。
 * テンプレート固有のフィールド(例: ランキングのtitle)は各テンプレートのschemaでextendする。
 */
export const mediaItemBaseSchema = z.object({
  src: z
    .string()
    .optional()
    .describe(
      "動画ファイルのパス(public/配下、staticFile()で参照)またはURL。未指定ならプレースホルダー背景で代替表示"
    ),
  caption: z.string().describe("このカットに重ねるテロップ"),
  durationInSeconds: z
    .number()
    .min(1)
    .max(12)
    .default(DEFAULT_CLIP_DURATION_IN_SECONDS)
    .describe("このカットの尺(秒)"),
  startFromSeconds: z
    .number()
    .min(0)
    .default(0)
    .describe("元動画の何秒目から切り出すか"),
  captionAnimation: captionAnimationSchema,
});
