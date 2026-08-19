import { z } from "zod";
import { zColor } from "@remotion/zod-types";
import { DEFAULT_CLIP_DURATION_IN_SECONDS, MAX_CLIPS, MIN_CLIPS } from "./constants";

// "remotion" / "@remotion/google-fonts" はReactのクライアント実行を前提にしており、
// スキーマ定義(Node.jsのAPIルートからも読み込まれる)に混ぜるとRSC環境で例外になる。
// そのためフォント名はここでは文字列リテラルとして持つ(実際の読み込みは font.ts が担う)。
const DEFAULT_FONT_FAMILY = '"Noto Sans JP", "Hiragino Sans", sans-serif';

export const clipSchema = z.object({
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
});

export const shortVideoSchema = z.object({
  hook: z.object({
    headline: z.string().describe("結論・数字を先出しするメインテロップ(0-3秒)"),
    subline: z.string().optional().describe("補足テロップ(任意)"),
  }),
  clips: z
    .array(clipSchema)
    .min(MIN_CLIPS)
    .max(MAX_CLIPS)
    .describe("本題パートを構成するクリップ(2〜4個)"),
  cta: z.object({
    text: z.string().default("詳しくはプロフィールへ"),
  }),
  theme: z.object({
    primaryColor: zColor().default("#FF3366"),
    fontFamily: z.string().default(DEFAULT_FONT_FAMILY),
  }),
});

export type ClipProps = z.infer<typeof clipSchema>;
export type ShortVideoProps = z.infer<typeof shortVideoSchema>;
