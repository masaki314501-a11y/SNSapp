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
export const resolveOverlayLayout = (
  overlay: OverlayLayoutInput
): { fontSizePx: number; xPercent: number; lines: string[] } => {
  // 指定の大きさのままだと1行が画面に収まらず言葉の途中で折り返されるため、1行ずつ収まる大きさまで縮める
  // (帯を付ける時は左右の余白0.8文字ぶんも見込む)。下限まで縮めても入らない行は、文節の切れ目で改行する。
  const paddingEm = overlay.backgroundColor ? 0.8 : 0;
  const fontSizePx = fitFontSizeToWidth(overlay.text, overlay.fontSizePx, MAX_OVERLAY_WIDTH_PX - overlay.fontSizePx * paddingEm, 40);
  const lines = breakIntoLines(overlay.text, fontSizePx, MAX_OVERLAY_WIDTH_PX - fontSizePx * paddingEm);
  const widestPx = Math.max(1, ...lines.map((line) => lineWidthEm(line) * fontSizePx));
  const xPercent = keepInsideHorizontally(overlay.xPercent, Math.min(MAX_OVERLAY_WIDTH_PX, widestPx + fontSizePx * paddingEm));
  return { fontSizePx, xPercent, lines };
};

/** 画面上の四角い範囲(%)。左上と右下。 */
export type BoxPercent = { left: number; top: number; right: number; bottom: number };

/**
 * 文字が画面のどこを占めるかの見積もり(%)。縁取り・帯の余白も含める。折り返しは最大幅を超えた分だけ見込む。
 * 自動編集で文字どうしが重ならないように確かめる時に使う(描画と完全に一致はしないので、少し大きめに見積もる)。
 */
export const estimateOverlayBox = (overlay: OverlayLayoutInput & Pick<TextOverlay, "yPercent">): BoxPercent => {
  const { fontSizePx, xPercent, lines } = resolveOverlayLayout(overlay);
  const paddingEm = overlay.backgroundColor ? 0.8 : 0.3;
  const widthPx = Math.max(...lines.map((line) => lineWidthEm(line) * fontSizePx)) + fontSizePx * paddingEm;
  const heightPx = lines.length * fontSizePx * 1.2 + fontSizePx * (overlay.backgroundColor ? 0.24 : 0.2);
  const halfWidth = (widthPx / VIDEO_WIDTH) * 50;
  const halfHeight = (heightPx / VIDEO_HEIGHT) * 50;
  return {
    left: xPercent - halfWidth,
    right: xPercent + halfWidth,
    top: overlay.yPercent - halfHeight,
    bottom: overlay.yPercent + halfHeight,
  };
};

/** 行頭に来てはいけない文字(句読点・長音・小さい仮名・閉じかっこ等)。 */
const NO_LINE_START = /^[、。，．,.・：:；;？！?!）)」』】〕＞>ー〜～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
const HIRAGANA = /^[ぁ-ゖ]/;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "word" }) : null;

/**
 * 文を「ここで改行してよい」かたまり(だいたい文節)に分ける。ひらがなで始まる語は前の語にくっつける
 * (「知っ/て/いる」→「知っている」)。ただし「お」「ご」の後に漢字が続く時は、そこからが新しいかたまり
 * (「歯のお/悩み」にしない)。keepTogetherの語(強調する語)は途中で切らない。
 */
const splitIntoPhrases = (text: string, keepTogether: string[]): string[][] => {
  const words = [...new Set(keepTogether.map((w) => w.trim()).filter((w) => w.length > 0))].sort((a, b) => b.length - a.length);
  const tokens: string[] = [];
  const pattern = words.length > 0 ? new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`) : null;
  for (const part of pattern ? text.split(pattern) : [text]) {
    if (!part) continue;
    if (words.includes(part) || !segmenter) {
      tokens.push(part);
      continue;
    }
    for (const { segment } of segmenter.segment(part)) tokens.push(segment);
  }
  // かたまりごとに、元の語の並びも持っておく(かたまりが1行に入らない時は、語の切れ目で分けるため)
  const phrases: string[][] = [];
  tokens.forEach((token, index) => {
    const next = tokens[index + 1] ?? "";
    const previous = phrases[phrases.length - 1];
    const startsPhrase =
      previous === undefined ||
      (!NO_LINE_START.test(token) &&
        !/^\s+$/.test(token) &&
        (!HIRAGANA.test(token) || (/^[おご]$/.test(token) && /^[一-龯]/.test(next))) &&
        // 前のかたまりが「お」「ご」だけなら、続く漢字はくっつける
        !/^[おご]$/.test(previous.join("")));
    if (startsPhrase) phrases.push([token]);
    else previous.push(token);
  });
  return phrases;
};

/**
 * 文字を行に分ける。描く側(ブラウザ・書き出し)の自動の折り返しに任せると、ブラウザ内での書き出し
 * (@remotion/web-renderer)で行が重なったり、言葉の途中で折り返されたりしたため、改行位置はここで決めて
 * 1行ずつ描く。明示した改行(\n)は必ず守り、長い行は文節の切れ目で、行の長さがそろうように分ける。
 * scaledWordsの語は文字の幅をscale倍として数える(テロップの強調する語は大きく描くため)。
 */
export const breakIntoLines = (
  text: string,
  fontSizePx: number,
  maxWidthPx: number,
  scaledWords: string[] = [],
  scale = 1
): string[] => {
  const widthOf = (value: string): number => {
    let width = lineWidthEm(value) * fontSizePx;
    for (const word of scaledWords) {
      if (!word) continue;
      const count = value.split(word).length - 1;
      width += count * lineWidthEm(word) * fontSizePx * (scale - 1);
    }
    return width;
  };
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const total = widthOf(trimmed);
    if (total <= maxWidthPx) {
      lines.push(trimmed);
      continue;
    }
    // 1つで最大幅を超えるかたまりは語の切れ目で分け、それでも入らない語(強調する語以外)だけ文字単位にする
    const phrases = splitIntoPhrases(trimmed, scaledWords).flatMap((phrase) =>
      widthOf(phrase.join("")) <= maxWidthPx
        ? [phrase.join("")]
        : phrase.flatMap((word) => (widthOf(word) <= maxWidthPx || scaledWords.includes(word) ? [word] : Array.from(word)))
    );
    const pack = (limit: number): string[] => {
      const packed: string[] = [];
      for (const phrase of phrases) {
        const last = packed[packed.length - 1];
        if (last !== undefined && widthOf(last + phrase) <= limit) packed[packed.length - 1] = last + phrase;
        else packed.push(phrase);
      }
      return packed.map((line) => line.trim());
    };
    const greedy = pack(maxWidthPx);
    // 行の長さをそろえる: 同じ行数に収まる範囲で、一番短い上限を探す(最後の行に少しだけ落ちるのを防ぐ)
    let best = greedy;
    for (let limit = total / greedy.length; limit < maxWidthPx; limit += fontSizePx * 0.5) {
      const candidate = pack(limit);
      if (candidate.length <= greedy.length) {
        best = candidate;
        break;
      }
    }
    lines.push(...best);
  }
  return lines;
};

/**
 * 1行ずつの見た目。行ごとに別のブロックにして、行の中では折り返さない(breakIntoLinesで決めた所でだけ改行する)。
 * ブラウザ内の書き出しでも、行の位置がずれて重なることがない。
 */
export const LINE_STYLE = { display: "block", whiteSpace: "nowrap" } as React.CSSProperties;
