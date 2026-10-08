import type React from "react";
import { VIDEO_HEIGHT, VIDEO_WIDTH } from "./constants";
import type { TextOverlay } from "./schema";

/**
 * 日本語の文字を画面に出す時の折り返し方。日本語は何も指定しないと幅が足りなくなった所で
 * どの文字の間でも折り返すため、「リベン/ジ」「3倍/!」のように言葉の途中で改行されて読みにくかった。
 * - wordBreak: auto-phrase … 文節の切れ目で折り返す(対応ブラウザのみ。要素にlang="ja"が必要)
 * - textWrap: balance … 行の長さをそろえ、最後の行に1〜2文字だけ落ちるのを防ぐ
 * - lineBreak: strict … 「ー」「っ」や句読点が行頭に来ないようにする
 * 対応していないブラウザでは従来の折り返しになるだけなので、そのまま指定してよい。
 * (csstypeの型にまだ無い値があるため、型はここでまとめて合わせる)
 */
export const JAPANESE_WRAP_STYLE = {
  wordBreak: "auto-phrase",
  textWrap: "balance",
  lineBreak: "strict",
} as unknown as React.CSSProperties;

/** 半角(英数字・記号・半角カナ)は全角のおよそ半分の幅として数える。 */
const charWidthEm = (char: string): number => (/[ -~｡-ﾟ]/.test(char) ? 0.55 : 1);

const lineWidthEm = (line: string): number => Array.from(line).reduce((sum, char) => sum + charWidthEm(char), 0);

/** 一番長い行の幅(px)の見積もり。折り返しが起きない前提の目安。 */
export const estimateTextWidthPx = (text: string, fontSizePx: number): number =>
  Math.max(1, ...text.split("\n").map(lineWidthEm)) * fontSizePx;

/**
 * 1行ずつ(明示した改行の単位で)、指定の幅に収まる文字の大きさを返す。大きすぎる文字は
 * 言葉の途中で折り返されてしまうため、収まる大きさまで縮める。ただし長文を無理に1行へ詰めて
 * 読めないほど小さくしないよう、下限(minFontSizePx)より下げない(その場合は文節の切れ目で折り返す)。
 */
export const fitFontSizeToWidth = (
  text: string,
  fontSizePx: number,
  maxWidthPx: number,
  minFontSizePx: number
): number => {
  const longest = Math.max(1, ...text.split("\n").map(lineWidthEm));
  return Math.max(Math.min(fontSizePx, Math.floor(maxWidthPx / longest)), Math.min(minFontSizePx, fontSizePx));
};

/** 強調テキストの最大幅(画面の9割)。 */
const MAX_OVERLAY_WIDTH_PX = VIDEO_WIDTH * 0.9;
/** 画面の左右の端から最低限あける余白(画面幅に対する%)。 */
const EDGE_MARGIN_PERCENT = 2;

/**
 * 文字の中心の横位置を、文字が画面の左右からはみ出さない所まで内側へ寄せる。
 * 中心で位置を指定させているので、画面端に近い指定(左上のタイトル等)で長い文字だと半分が画面の外に出て切れていた。
 */
const keepInsideHorizontally = (xPercent: number, widthPx: number): number => {
  const halfPercent = (widthPx / VIDEO_WIDTH) * 50;
  const min = halfPercent + EDGE_MARGIN_PERCENT;
  const max = 100 - halfPercent - EDGE_MARGIN_PERCENT;
  return min > max ? 50 : Math.min(Math.max(xPercent, min), max);
};

type OverlayLayoutInput = Pick<TextOverlay, "text" | "fontSizePx" | "xPercent" | "backgroundColor">;

/**
 * 実際に描く文字の大きさと横位置。描画(TextOverlays.tsx)・編集画面のドラッグ用の枠(PreviewDragLayer.tsx)・
 * 自動編集の重なりの確認(autoEditPlan.ts)で同じ計算を使う。
 */
export const resolveOverlayLayout = (overlay: OverlayLayoutInput): { fontSizePx: number; xPercent: number } => {
  // 指定の大きさのままだと1行が画面に収まらず言葉の途中で折り返されるため、1行ずつ収まる大きさまで縮める
  // (帯を付ける時は左右の余白0.8文字ぶんも見込む)。
  const paddingEm = overlay.backgroundColor ? 0.8 : 0;
  const fontSizePx = fitFontSizeToWidth(overlay.text, overlay.fontSizePx, MAX_OVERLAY_WIDTH_PX - overlay.fontSizePx * paddingEm, 40);
  const xPercent = keepInsideHorizontally(
    overlay.xPercent,
    Math.min(MAX_OVERLAY_WIDTH_PX, estimateTextWidthPx(overlay.text, fontSizePx) + fontSizePx * paddingEm)
  );
  return { fontSizePx, xPercent };
};

/** 画面上の四角い範囲(%)。左上と右下。 */
export type BoxPercent = { left: number; top: number; right: number; bottom: number };

/**
 * 文字が画面のどこを占めるかの見積もり(%)。縁取り・帯の余白も含める。折り返しは最大幅を超えた分だけ見込む。
 * 自動編集で文字どうしが重ならないように確かめる時に使う(描画と完全に一致はしないので、少し大きめに見積もる)。
 */
export const estimateOverlayBox = (overlay: OverlayLayoutInput & Pick<TextOverlay, "yPercent">): BoxPercent => {
  const { fontSizePx, xPercent } = resolveOverlayLayout(overlay);
  const paddingEm = overlay.backgroundColor ? 0.8 : 0.3;
  const lineWidths = overlay.text.split("\n").map((line) => lineWidthEm(line) * fontSizePx);
  const lineCount = lineWidths.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / MAX_OVERLAY_WIDTH_PX)), 0);
  const widthPx = Math.min(MAX_OVERLAY_WIDTH_PX, Math.max(...lineWidths)) + fontSizePx * paddingEm;
  const heightPx = lineCount * fontSizePx * 1.2 + fontSizePx * (overlay.backgroundColor ? 0.24 : 0.2);
  const halfWidth = (widthPx / VIDEO_WIDTH) * 50;
  const halfHeight = (heightPx / VIDEO_HEIGHT) * 50;
  return {
    left: xPercent - halfWidth,
    right: xPercent + halfWidth,
    top: overlay.yPercent - halfHeight,
    bottom: overlay.yPercent + halfHeight,
  };
};
