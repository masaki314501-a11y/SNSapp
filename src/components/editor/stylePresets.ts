import type {
  CaptionAnimation,
  CaptionFontFamily,
  CaptionFontSize,
  CaptionPosition,
  CaptionStyle,
} from "@video/shared/schema";

/**
 * 配色・フォント・位置・見た目・演出をまとめて1クリックで適用できるスタイルプリセット。
 * 値は remotion/shared/schema.ts の各オプション一覧から実在するものだけを選んでいる。
 */
export type StylePreset = {
  id: string;
  label: string;
  description: string;
  primaryColor: string;
  captionStyle: CaptionStyle;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  fontSize: CaptionFontSize;
  fadeInOut: boolean;
  captionAnimation: CaptionAnimation;
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "pop-live",
    label: "ポップ配信",
    description: "原色カラー背景+丸ゴシックで元気な印象",
    primaryColor: "#FF3366",
    captionStyle: "pill",
    fontFamily: "M PLUS Rounded 1c",
    captionPosition: "bottom",
    fontSize: "medium",
    fadeInOut: false,
    captionAnimation: "pop",
  },
  {
    id: "impact-bold",
    label: "インパクト太字",
    description: "極太フォント+大きめ文字で強く目を引く",
    primaryColor: "#FFD400",
    captionStyle: "pill",
    fontFamily: "Dela Gothic One",
    captionPosition: "bottom",
    fontSize: "large",
    fadeInOut: false,
    captionAnimation: "shake-in",
  },
  {
    id: "elegant-cinema",
    label: "上品・シネマ",
    description: "縁取り文字+明朝体+全体フェードで落ち着いた雰囲気",
    primaryColor: "#F4F1EA",
    captionStyle: "outline",
    fontFamily: "Noto Serif JP",
    captionPosition: "bottom",
    fontSize: "medium",
    fadeInOut: true,
    captionAnimation: "fade",
  },
  {
    id: "minimal-clean",
    label: "ミニマル",
    description: "縁取り文字+標準ゴシックでクセなく使える",
    primaryColor: "#111111",
    captionStyle: "outline",
    fontFamily: "Noto Sans JP",
    captionPosition: "bottom",
    fontSize: "medium",
    fadeInOut: false,
    captionAnimation: "slide-up",
  },
  {
    id: "natural-handwritten",
    label: "ナチュラル",
    description: "手書き風フォント+中央配置でやわらかい雰囲気",
    primaryColor: "#7A9E7E",
    captionStyle: "pill",
    fontFamily: "Yomogi",
    captionPosition: "middle",
    fontSize: "medium",
    fadeInOut: false,
    captionAnimation: "fade",
  },
  {
    id: "marker-highlight",
    label: "マーカー強調",
    description: "上部配置+マーカーで塗るアニメーションで解説動画向け",
    primaryColor: "#3366FF",
    captionStyle: "pill",
    fontFamily: "Zen Kaku Gothic New",
    captionPosition: "top",
    fontSize: "medium",
    fadeInOut: false,
    captionAnimation: "highlight-sweep",
  },
];
