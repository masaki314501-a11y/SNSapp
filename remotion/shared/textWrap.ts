import type React from "react";

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
