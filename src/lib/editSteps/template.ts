import type { CaptionFontFamily, CaptionFontSize, CaptionLayout, ShapeOverlay, TextOverlay } from "@video/shared/schema";
import { estimateTextWidthPx } from "@video/shared/textWrap";
import type { FrameFill, StepState } from "./logic";

/**
 * 見た目の手本ごとの「型」。手本の画面から測った、文字・帯・枠・カードの見た目と置き方。
 * 手本に型がある時は、工程6〜10の見た目・置き方をAIに任せず、型どおりにする(AIが決めるのは中身だけ:
 * タイトルの文言・ランキングの数・枠に入れる項目・強調する字幕)。
 * AIに手本を見せて真似させるやり方では、色・位置が毎回ずれて、手本と別物になったため(2026-11 先方確認)。
 * 型は data/reference-templates/ に、手本1本につき1つのJSONで置く(templateStore.ts で読む)。
 */

/** 文字の見た目。 */
export type TemplateTextLook = {
  fontFamily?: CaptionFontFamily;
  color: string;
  strokeColor?: string;
  strokeWidthPx?: number;
  /** 文字の後ろの帯の色(帯が無ければ省く)。 */
  bandColor?: string;
};

/** 箱(中心の位置と大きさ。画面に対する%)。 */
export type TemplateBox = { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };

/** 枠・カードの見た目。 */
export type TemplateShape = {
  borderColor?: string;
  borderWidthPx: number;
  fillColor?: string;
  fillOpacity: number;
  cornerRadiusPx: number;
};

export type ReferenceTemplate = {
  /** 型の名前(手本の名前)。 */
  name: string;
  /** この型を使う手本(保存した手本のファイル名から拡張子を除いた物。YouTubeは動画のID)。 */
  referenceIds: string[];
  /** 出し方: ranking=枠を縦に並べて項目を入れていく、compare=2枚のカードで比べる、none=タイトルだけ。 */
  kind: "ranking" | "compare" | "none";
  /** 手本の人物の顔(中心の位置と顔の高さ。%)。 */
  face?: { xPercent: number; yPercent: number; heightPercent: number };
  /** 基本の字幕。topPercent は字幕の上端。 */
  caption: {
    topPercent: number;
    /** 字幕の下の端(%)。あれば下の端を固定し、2行になると上へ伸ばす(下に置いた見出し・カードに重ならないように)。 */
    bottomPercent?: number;
    xPercent: number;
    maxWidthPercent: number;
    fontSize: CaptionFontSize;
    fontFamily: CaptionFontFamily;
    style: "outline" | "pill";
    textColor: string;
    /** 縁取り(outline)か帯(pill)の色。 */
    accentColor: string;
  };
  /** 強調した字幕。 */
  emphasis: { fontFamily: CaptionFontFamily; textColor: string; bandColor: string | null; strokeColor?: string };
  title: {
    align: "left" | "center";
    /** 中央寄せは中心、左寄せは左端の横位置(%)。 */
    xPercent: number;
    /** タイトル全体(全部の行)の中心の縦位置(%)。 */
    yPercent: number;
    fontSizePx: number;
    /** 1行の幅の上限(画面の幅に対する%)。長いタイトルはここに収まるまで文字を小さくする。 */
    maxWidthPercent: number;
    /** 何行で書くか(AIにタイトルを考えてもらう時に伝える)。 */
    lineCount: number;
    /** 行ごとの見た目(1行目・2行目…。行が多い時は最後の見た目を使う)。 */
    lines: TemplateTextLook[];
    /** 画面の端から端までの帯(タイトルの後ろ)。 */
    band?: { color: string; topPercent: number; heightPercent: number };
    /** 冒頭に、画面の真ん中あたりへ大きく出してから、いつもの位置へ縮みながら動く。 */
    intro?: { seconds: number; xPercent: number; yPercent: number; fontSizePx: number };
  };
  /** ランキングの枠(kind=ranking)。 */
  frames?: {
    xPercent: number;
    widthPercent: number;
    /** 枠を並べる範囲(1つ目の枠の上端〜最後の枠の下端。%)。 */
    topPercent: number;
    bottomPercent: number;
    gapPercent: number;
    /** 枠1つの高さの上限(%)。項目が少ない時に大きくしすぎない。 */
    maxHeightPercent: number;
    /** AIが数を決められなかった時の枠の数(手本の数)。 */
    defaultCount: number;
    shape: TemplateShape;
    /** 番号。{n}を番号に置き換える(例「{n}位」)。枠の左下に置く。 */
    number: { format: string; fontSizePx: number; look: TemplateTextLook };
    /** 枠に入れる項目名(枠の真ん中)。 */
    label: { fontSizePx: number; look: TemplateTextLook };
  };
  /** 比べる2枚のカード(kind=compare)。 */
  compare?: {
    cards: [TemplateBox, TemplateBox];
    shape: TemplateShape;
    /** 比べる物の名前(カードの下の方。カードの下端からこの%だけ上に、文字の中心を置く)。 */
    name: { fontSizePx: number; look: TemplateTextLook; fromBottomPercent: number };
    /** 話題ごとの中身(カードの名前より上の所)。 */
    content: { fontSizePx: number; look: TemplateTextLook };
    /** 今の話題の見出し(カードの上。話題ごとに入れ替わる)。 */
    topic?: { xPercent: number; yPercent: number; fontSizePx: number; look: TemplateTextLook };
  };
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const VIDEO_WIDTH = 1080;
const VIDEO_HEIGHT = 1920;
/** 行の間隔(文字の大きさに対する倍)。 */
const LINE_HEIGHT = 1.25;
/** 型どおりに置いた物の目印(入れ直す時に、前に入れた物を見分けて外すため)。 */
export const TEMPLATE_FILL_TAG = "template-fill";

/** 文字の幅(em)。帯がある時は左右の余白0.8文字、縁取りだけの時は0.3文字を足す。 */
const widthEm = (text: string, look: TemplateTextLook) => estimateTextWidthPx(text, 1) + (look.bandColor ? 0.8 : 0.3);

/** 幅に収まる文字の大きさ(px)。大きくても base まで。 */
const fitFontSize = (texts: { text: string; look: TemplateTextLook }[], base: number, maxWidthPercent: number, min = 28) => {
  const maxWidthPx = (maxWidthPercent / 100) * VIDEO_WIDTH;
  const longest = Math.max(1, ...texts.map(({ text, look }) => widthEm(text, look)));
  return Math.max(min, Math.min(base, Math.floor(maxWidthPx / longest)));
};

const textOverlay = (
  text: string,
  look: TemplateTextLook,
  at: { xPercent: number; yPercent: number; fontSizePx: number }
): TextOverlay => ({
  text,
  startOffsetSeconds: 0,
  xPercent: round2(at.xPercent),
  yPercent: round2(at.yPercent),
  fontSizePx: Math.round(at.fontSizePx),
  color: look.color,
  ...(look.strokeColor ? { strokeColor: look.strokeColor } : {}),
  ...(look.strokeColor ? { strokeWidthPx: look.strokeWidthPx ?? Math.max(3, Math.round(at.fontSizePx * 0.08)) } : {}),
  ...(look.bandColor ? { backgroundColor: look.bandColor } : {}),
  ...(look.fontFamily ? { fontFamily: look.fontFamily } : {}),
  rotationDeg: 0,
  animation: "fade",
  textAlign: "center",
});

const shapeOf = (box: TemplateBox, shape: TemplateShape, extra: Partial<ShapeOverlay> = {}): ShapeOverlay => ({
  kind: "rect",
  startOffsetSeconds: 0,
  xPercent: round2(box.xPercent),
  yPercent: round2(box.yPercent),
  widthPercent: round2(box.widthPercent),
  heightPercent: round2(box.heightPercent),
  ...(shape.borderColor && shape.borderWidthPx > 0 ? { borderColor: shape.borderColor } : {}),
  borderWidthPx: shape.borderWidthPx,
  ...(shape.fillColor ? { fillColor: shape.fillColor } : {}),
  fillOpacity: shape.fillOpacity,
  cornerRadiusPx: shape.cornerRadiusPx,
  animation: "fade",
  ...extra,
});

/** 文字の高さ(%)。 */
const lineStepPercent = (fontSizePx: number) => ((fontSizePx * LINE_HEIGHT) / VIDEO_HEIGHT) * 100;

/** ランキングの枠の箱(上から順)。 */
export const templateFrameBoxes = (frames: NonNullable<ReferenceTemplate["frames"]>, count: number): TemplateBox[] => {
  const n = Math.max(1, count);
  const height = Math.min(frames.maxHeightPercent, (frames.bottomPercent - frames.topPercent - frames.gapPercent * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({
    xPercent: frames.xPercent,
    yPercent: frames.topPercent + height / 2 + i * (height + frames.gapPercent),
    widthPercent: frames.widthPercent,
    heightPercent: height,
  }));
};

/**
 * 8. 型どおりに、タイトル(と帯)・ランキングの枠と番号・比べるカードを置く。
 * 文言(タイトル)と数(枠の数)だけが動画ごとに変わる。
 */
export const buildTemplateObjects = (params: {
  template: ReferenceTemplate;
  title: string;
  frameCount: number;
}): { globalOverlays: TextOverlay[]; globalShapes: ShapeOverlay[] } => {
  const { template } = params;
  const title = template.title;
  const lines = params.title.split("\n").map((line) => line.trim()).filter(Boolean);
  const lookOf = (index: number) => title.lines[Math.min(index, title.lines.length - 1)];
  const items = lines.map((text, index) => ({ text, look: lookOf(index) }));
  const fontSizePx = fitFontSize(items, title.fontSizePx, title.maxWidthPercent);
  const step = lineStepPercent(fontSizePx);
  const shapes: ShapeOverlay[] = [];
  const overlays: TextOverlay[] = [];
  if (title.band) {
    shapes.push(
      shapeOf(
        { xPercent: 50, yPercent: title.band.topPercent + title.band.heightPercent / 2, widthPercent: 100, heightPercent: title.band.heightPercent },
        { fillColor: title.band.color, fillOpacity: 1, borderWidthPx: 0, cornerRadiusPx: 0 },
        { decorative: true, animation: "none" }
      )
    );
  }
  const intro = title.intro;
  const introFont = intro ? fitFontSize(items, intro.fontSizePx, 92) : 0;
  items.forEach(({ text, look }, index) => {
    const offset = index - (items.length - 1) / 2;
    const width = (widthEm(text, look) * fontSizePx * 100) / VIDEO_WIDTH;
    const xPercent = title.align === "center" ? title.xPercent : title.xPercent + width / 2;
    const yPercent = title.yPercent + offset * step;
    const placed = textOverlay(text, look, { xPercent, yPercent, fontSizePx });
    if (!intro) {
      overlays.push(placed);
      return;
    }
    // 冒頭は真ん中に大きく出し、その後いつもの位置へ縮みながら動く
    const introY = intro.yPercent + offset * lineStepPercent(introFont);
    overlays.push({
      ...textOverlay(text, look, { xPercent: intro.xPercent, yPercent: introY, fontSizePx: introFont }),
      durationInSeconds: intro.seconds,
      animation: "pop",
    });
    overlays.push({
      ...placed,
      startOffsetSeconds: intro.seconds,
      moveFrom: { xPercent: round2(intro.xPercent), yPercent: round2(introY), fontSizePx: Math.round(introFont) },
    });
  });

  if (template.kind === "ranking" && template.frames) {
    const frames = template.frames;
    const count = Math.min(10, Math.max(2, params.frameCount >= 2 ? params.frameCount : frames.defaultCount));
    const boxes = templateFrameBoxes(frames, count);
    boxes.forEach((box, index) => {
      shapes.push(shapeOf(box, frames.shape));
      const label = frames.number.format.replace("{n}", String(index + 1));
      const size = Math.min(frames.number.fontSizePx, Math.round((box.heightPercent / 100) * VIDEO_HEIGHT * 0.4));
      const width = (widthEm(label, frames.number.look) * size * 100) / VIDEO_WIDTH;
      const left = box.xPercent - box.widthPercent / 2;
      const bottom = box.yPercent + box.heightPercent / 2;
      overlays.push(
        textOverlay(label, frames.number.look, {
          xPercent: left + 1.5 + width / 2,
          yPercent: bottom - ((size * 0.65) / VIDEO_HEIGHT) * 100 - 0.4,
          fontSizePx: size,
        })
      );
    });
  }
  if (template.kind === "compare" && template.compare) {
    for (const card of template.compare.cards) shapes.push(shapeOf(card, template.compare.shape));
  }
  return { globalOverlays: overlays, globalShapes: shapes };
};

/** 型の字幕の置き方(工程7)。 */
export const templateCaption = (template: ReferenceTemplate): { yPercent: number; fontSize: CaptionFontSize; layout: CaptionLayout } => ({
  yPercent: template.caption.topPercent,
  fontSize: template.caption.fontSize,
  layout: {
    xPercent: template.caption.xPercent,
    maxWidthPercent: template.caption.maxWidthPercent,
    textColor: template.caption.textColor,
    ...(template.caption.bottomPercent !== undefined ? { bottomPercent: template.caption.bottomPercent } : {}),
  },
});

/** 完成の動画で、各項目を出し始める時刻(秒)。言い始めのクリップが外されていたら、その後の最初のクリップから。 */
export const fillStartSeconds = (state: StepState): ((fill: FrameFill) => number | undefined) => {
  const starts = new Map<string, number>();
  let t = 0;
  for (const segment of state.segments) {
    starts.set(segment.key, t);
    t += segment.durationInSeconds;
  }
  return (fill) => {
    const direct = starts.get(fill.key);
    if (direct !== undefined) return direct;
    const after = state.segments.find((segment) => segment.startFromSeconds >= fill.sourceSeconds);
    return after ? starts.get(after.key) : undefined;
  };
};

/** 比べるカードで、見出し(今の話題)を入れる番号。カード1・2の後の3。 */
export const TOPIC_FRAME = 3;

/**
 * 10・12. 型どおりに、枠・カードへ項目を入れる(前に入れた物は外して入れ直す)。
 * ランキング: 枠の真ん中に項目名(言い始めた時から最後まで)。
 * 比べる: カードの下に名前(最初に出てから最後まで)、名前の上に話題ごとの中身(次の中身が出たら入れ替わる)、
 * カードの上に今の話題の見出し(次の見出しが出たら入れ替わる)。
 */
export const placeTemplateFills = (state: StepState, template: ReferenceTemplate): StepState => {
  const base = state.globalOverlays.filter((overlay) => overlay.tag !== TEMPLATE_FILL_TAG);
  const fills = state.frameFills ?? [];
  if (fills.length === 0) return { ...state, globalOverlays: base };
  const startOf = fillStartSeconds(state);
  const rects = state.globalShapes.filter((shape) => shape.kind === "rect" && !shape.decorative);
  const placed = fills
    .map((fill) => ({ fill, start: startOf(fill) }))
    .filter((item): item is { fill: FrameFill; start: number } => item.start !== undefined)
    .sort((a, b) => a.start - b.start);
  const texts: TextOverlay[] = [];
  const tagged = (overlay: TextOverlay, start: number, end?: number): TextOverlay => ({
    ...overlay,
    startOffsetSeconds: round2(start),
    ...(end !== undefined && end - start >= 0.2 ? { durationInSeconds: round2(end - start) } : {}),
    animation: "pop",
    tag: TEMPLATE_FILL_TAG,
  });

  if (template.kind === "ranking" && template.frames) {
    const label = template.frames.label;
    for (const { fill, start } of placed) {
      const rect = rects[fill.frame - 1];
      if (!rect) continue;
      const size = Math.min(
        fitFontSize([{ text: fill.label, look: label.look }], label.fontSizePx, rect.widthPercent - 6, 24),
        Math.round((rect.heightPercent / 100) * VIDEO_HEIGHT * 0.35)
      );
      texts.push(tagged(textOverlay(fill.label, label.look, { xPercent: rect.xPercent, yPercent: rect.yPercent - rect.heightPercent * 0.1, fontSizePx: size }), start));
    }
  }

  if (template.kind === "compare" && template.compare) {
    const compare = template.compare;
    // 番号ごとに、出す順に並べる
    const byFrame = new Map<number, { fill: FrameFill; start: number }[]>();
    for (const item of placed) byFrame.set(item.fill.frame, [...(byFrame.get(item.fill.frame) ?? []), item]);
    // 中身・見出しの文字の大きさは、そろえる(話題ごとに大きさが変わると落ち着かないため)
    [1, 2].forEach((frame) => {
      const card = compare.cards[frame - 1];
      const items = byFrame.get(frame) ?? [];
      if (!card || items.length === 0) return;
      const [name, ...contents] = items;
      const nameSize = fitFontSize([{ text: name.fill.label, look: compare.name.look }], compare.name.fontSizePx, card.widthPercent - 4);
      const nameY = card.yPercent + card.heightPercent / 2 - compare.name.fromBottomPercent;
      texts.push(tagged(textOverlay(name.fill.label, compare.name.look, { xPercent: card.xPercent, yPercent: nameY, fontSizePx: nameSize }), name.start));
      if (contents.length === 0) return;
      const contentSize = fitFontSize(
        [...(byFrame.get(1) ?? []).slice(1), ...(byFrame.get(2) ?? []).slice(1)].map((item) => ({ text: item.fill.label, look: compare.content.look })),
        compare.content.fontSizePx,
        card.widthPercent - 6
      );
      const top = card.yPercent - card.heightPercent / 2;
      const contentY = (top + nameY - ((nameSize * 0.7) / VIDEO_HEIGHT) * 100) / 2;
      // 中身は、次の中身が出るか、話題の見出しが次へ変わった時に消す(前の話題の中身が残らないように)
      const topicStarts = (byFrame.get(TOPIC_FRAME) ?? []).map((item) => item.start);
      contents.forEach((item, index) => {
        const nextTopic = topicStarts.find((start) => start > item.start + 0.2);
        const ends = [contents[index + 1]?.start, nextTopic].filter((value): value is number => value !== undefined);
        texts.push(
          tagged(
            textOverlay(item.fill.label, compare.content.look, { xPercent: card.xPercent, yPercent: contentY, fontSizePx: contentSize }),
            item.start,
            ends.length > 0 ? Math.min(...ends) : undefined
          )
        );
      });
    });
    const topics = byFrame.get(TOPIC_FRAME) ?? [];
    if (compare.topic && topics.length > 0) {
      const topic = compare.topic;
      const size = fitFontSize(topics.map((item) => ({ text: item.fill.label, look: topic.look })), topic.fontSizePx, 80);
      topics.forEach((item, index) => {
        texts.push(
          tagged(textOverlay(item.fill.label, topic.look, { xPercent: topic.xPercent, yPercent: topic.yPercent, fontSizePx: size }), item.start, topics[index + 1]?.start)
        );
      });
    }
  }
  return { ...state, globalOverlays: [...base, ...texts] };
};
