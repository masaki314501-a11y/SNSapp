import type { CaptionFontFamily, ImageOverlay, TextOverlay } from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";

/**
 * 工程8・10でAIが自由に描く図(円グラフ・採点表・比べる表・手順の図など、動画の中身に合わせた物)。
 * 置く場所(人と字幕に重ならない空いた所)はツールが決め、その中の絵はAIが SVG で描く。
 * 図の線・塗りは画像(SVG)として、図の中の文字は「画面に出す文字」として置く
 * (画像の中の文字には書体が効かないため。文字にしておくと、編集画面で直すこともできる)。
 * 工程8で「最初から出しておく土台」(空のグラフ・項目名だけの採点表など)を描き、工程10で、話に合わせて足していく部品
 * (グラフの1切れ・点数・〇印など)を、その部品の話を始める字幕と一緒に決める。
 */

/** 図の中の文字。x・yは図の座標(横0〜1000・縦0〜viewBoxの高さ)での文字の中心、sizeは図の座標での文字の高さ。 */
export type FigureText = { text: string; x: number; y: number; size: number; color: string; strokeColor: string | null };
/** 図の一部(SVGの線・塗り + 文字)。 */
export type FigureLayer = { svg: string; texts: FigureText[] };
/** 話に合わせて足す部品。key は出し始めるクリップ、sourceSeconds はその元の動画での時刻、label は先方の確認用の短い説明。 */
export type FigurePart = FigureLayer & { key: string; sourceSeconds: number; label: string };
/** 図を置く場所(%。画面に対する中心と大きさ)。 */
export type FigureBox = { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };

export type FigureDraft = {
  box: FigureBox;
  /** 図の座標の高さ(横は1000)。置く場所の縦横比に合わせる。 */
  viewBoxHeight: number;
  /** 何を表す図か(工程10で部品を足す時にAIへ渡す)。 */
  idea: string;
  base: FigureLayer;
  parts: FigurePart[];
  fontFamily?: CaptionFontFamily;
};

export const FIGURE_VIEWBOX_WIDTH = 1000;
const SCREEN_WIDTH_PX = 1080;
const SCREEN_HEIGHT_PX = 1920;
/** 図を置いてよい左右(%)。左の余白から、TikTokの右側のボタンの手前まで。 */
const FIGURE_LEFT_PERCENT = 7;
const FIGURE_RIGHT_PERCENT = 86;
/** 図を置いてよい一番下(%)。TikTokの説明文で隠れる所(下22%)の手前まで。 */
const FIGURE_LOWEST_PERCENT = 77;
/** 図の高さの上限・下限(%)。下限より低い所しか空いていなければ、図は置かない。 */
const FIGURE_MAX_HEIGHT_PERCENT = 30;
export const FIGURE_MIN_HEIGHT_PERCENT = 10;
/** 左上のタイトルの下端の見積もり(%。2行の時)。図は、これより下に置く。 */
const TITLE_BOTTOM_PERCENT = 20;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * 図を置く場所を決める。字幕が顎の下にあれば字幕の下、画面の下にあれば顔と字幕の間のうち、高く取れる方。
 * どちらも低すぎれば null(図は置かない)。
 */
export const figureArea = (params: {
  captionTopPercent: number;
  captionBottomPercent?: number;
  faceBottomPercent?: number;
}): FigureBox | null => {
  // 字幕の下に置く時は字幕に寄せて上から、顔と字幕の間に置く時は字幕に寄せて下から詰める
  type Area = { from: number; to: number; alignTop: boolean };
  const areas: Area[] = [];
  if (params.captionBottomPercent !== undefined) {
    areas.push({ from: params.captionBottomPercent + 2, to: FIGURE_LOWEST_PERCENT, alignTop: true });
  }
  areas.push({
    from: Math.max(TITLE_BOTTOM_PERCENT, (params.faceBottomPercent ?? 0) + 1),
    to: Math.min(params.captionTopPercent - 2, FIGURE_LOWEST_PERCENT),
    alignTop: false,
  });
  const best = areas.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  const height = Math.min(FIGURE_MAX_HEIGHT_PERCENT, best.to - best.from);
  if (height < FIGURE_MIN_HEIGHT_PERCENT) return null;
  const top = best.alignTop ? best.from : best.to - height;
  return {
    xPercent: round2((FIGURE_LEFT_PERCENT + FIGURE_RIGHT_PERCENT) / 2),
    yPercent: round2(top + height / 2),
    widthPercent: FIGURE_RIGHT_PERCENT - FIGURE_LEFT_PERCENT,
    heightPercent: round2(height),
  };
};

/** 置く場所の縦横比に合わせた、図の座標の高さ(横は1000)。 */
export const figureViewBoxHeight = (box: FigureBox): number =>
  Math.round((FIGURE_VIEWBOX_WIDTH * (box.heightPercent / 100) * SCREEN_HEIGHT_PX) / ((box.widthPercent / 100) * SCREEN_WIDTH_PX));

// ---- SVGを安全な形にする ----

/** 使ってよい要素と属性(絵を描く物だけ。スクリプト・外のファイルの読み込み・文字は通さない)。 */
const ALLOWED_TAGS = new Set(["g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const ALLOWED_ATTRS = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "opacity", "fill-opacity", "stroke-opacity", "transform",
]);
const SAFE_VALUE = /^[#\w\s.,%()+-]*$/;

/**
 * AIが書いたSVGの断片から、絵を描く要素と属性だけを残す(それ以外の要素・属性・文字は捨てる)。
 * 色や数値などの値も、記号の少ない物だけを通す(url(...)・javascript: などの読み込みを防ぐ)。
 */
export const sanitizeSvgFragment = (svg: string): string => {
  const out: string[] = [];
  const stack: string[] = [];
  for (const match of svg.matchAll(/<\s*(\/)?\s*([a-zA-Z]+)([^>]*?)(\/)?\s*>/g)) {
    const [, closing, rawTag, rawAttrs, selfClosing] = match;
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      // 開いている同じ要素がある時だけ閉じる(閉じ忘れ・閉じすぎで形が崩れないように)
      const at = stack.lastIndexOf(tag);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs: string[] = [];
    for (const attr of rawAttrs.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const name = attr[1].toLowerCase();
      const value = attr[3] ?? attr[4] ?? "";
      if (!ALLOWED_ATTRS.has(name) || !SAFE_VALUE.test(value) || /url|script/i.test(value)) continue;
      attrs.push(`${name}="${value}"`);
    }
    const open = `<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
    if (selfClosing || tag !== "g") {
      out.push(`${open}/>`);
    } else {
      out.push(`${open}>`);
      stack.push(tag);
    }
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("");
};

/** SVGの断片を、画像として置ける形(data:のURL)にする。 */
export const svgDataUrl = (fragment: string, viewBoxHeight: number): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FIGURE_VIEWBOX_WIDTH} ${viewBoxHeight}">${fragment}</svg>`
  )}`;

/** AIが描いた図の画像か(画像の出どころのチェックで、お客様の画像と分けるため)。 */
export const isFigureImage = (src: string): boolean => src.startsWith("data:image/svg+xml");

/** 図の画像で使っている色(チェック項目の色の数に入れるため)。 */
export const figureImageColors = (src: string): string[] =>
  isFigureImage(src) ? [...decodeURIComponent(src).matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0].toUpperCase()) : [];

const toScreenText = (
  text: FigureText,
  draft: Pick<FigureDraft, "box" | "viewBoxHeight" | "fontFamily">,
  start: number,
  animation: TextOverlay["animation"]
): TextOverlay => {
  const { box } = draft;
  const left = box.xPercent - box.widthPercent / 2;
  const top = box.yPercent - box.heightPercent / 2;
  const pxPerUnit = ((box.widthPercent / 100) * SCREEN_WIDTH_PX) / FIGURE_VIEWBOX_WIDTH;
  const clampTo = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    text: text.text,
    startOffsetSeconds: round2(start),
    xPercent: round2(left + (clampTo(text.x, FIGURE_VIEWBOX_WIDTH) / FIGURE_VIEWBOX_WIDTH) * box.widthPercent),
    yPercent: round2(top + (clampTo(text.y, draft.viewBoxHeight) / draft.viewBoxHeight) * box.heightPercent),
    fontSizePx: Math.round(Math.min(160, Math.max(24, text.size * pxPerUnit))),
    color: text.color,
    strokeColor: text.strokeColor ?? undefined,
    fontFamily: draft.fontFamily,
    rotationDeg: 0,
    animation,
  };
};

/**
 * 図を、画面に置く画像と文字にする。土台は動画の最初から、部品はその話を始めるクリップの時刻から、最後まで出す。
 * 場面を外した後(工程12)も呼び直して、出る時刻を合わせ直す。
 */
export const placeFigure = <S extends { segments: ProjectSegment[]; figure?: FigureDraft | null }>(
  state: S
): S & { figureImages: ImageOverlay[]; figureTexts: TextOverlay[] } => {
  const draft = state.figure;
  if (!draft) return { ...state, figureImages: [], figureTexts: [] };
  const starts = new Map<string, number>();
  let t = 0;
  for (const segment of state.segments) {
    starts.set(segment.key, t);
    t += segment.durationInSeconds;
  }
  const startOf = (part: FigurePart): number | undefined => {
    const direct = starts.get(part.key);
    if (direct !== undefined) return direct;
    // 出し始めのクリップが外された時は、その後に来る最初のクリップから出す
    const after = state.segments.find((segment) => segment.startFromSeconds >= part.sourceSeconds);
    return after ? starts.get(after.key) : undefined;
  };
  const image = (svg: string, start: number, animation: ImageOverlay["animation"]): ImageOverlay => ({
    src: svgDataUrl(svg, draft.viewBoxHeight),
    startOffsetSeconds: round2(start),
    xPercent: draft.box.xPercent,
    yPercent: draft.box.yPercent,
    widthPercent: draft.box.widthPercent,
    heightPercent: draft.box.heightPercent,
    rotationDeg: 0,
    cornerRadiusPx: 0,
    animation,
    fit: "contain",
  });
  const figureImages: ImageOverlay[] = [];
  const figureTexts: TextOverlay[] = [];
  if (draft.base.svg) figureImages.push(image(draft.base.svg, 0, "fade"));
  figureTexts.push(...draft.base.texts.map((text) => toScreenText(text, draft, 0, "fade")));
  for (const part of draft.parts) {
    const start = startOf(part);
    if (start === undefined) continue;
    if (part.svg) figureImages.push(image(part.svg, start, "pop"));
    figureTexts.push(...part.texts.map((text) => toScreenText(text, draft, start, "pop")));
  }
  return { ...state, figureImages, figureTexts };
};
