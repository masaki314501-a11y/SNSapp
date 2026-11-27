import type {
  CaptionAnimation,
  CaptionFontFamily,
  CaptionFontSize,
  CaptionLayout,
  ImageOverlay,
  ShapeOverlay,
  TextOverlay,
} from "@video/shared/schema";
import { estimateTextWidthPx } from "@video/shared/textWrap";
import type { FrameFill, StepState } from "./logic";

/**
 * 見た目の手本の「型」。お客様が添付した手本動画から、アプリが自動で読み取る(templateExtract.ts)。
 * 型には、手本の見た目と「並べ方・出し方の決まり」だけを入れる。動画ごとに変わる物(タイトルの文言・項目の数と名前・
 * 枠に入れる画像・強調する字幕・丸を付けるカード・最後の一言の文言)は、型には入れず、今回の動画の話からAIが決める。
 * 手本と話の内容が合わない時(手本はランキングなのに話は比べる内容など)は、話の内容を優先する(route.ts の工程8)。
 * AIに手本を見せて真似させるだけのやり方では、色・位置が毎回ずれて手本と別物になったため(2026-11 先方確認)。
 */

/** 文字の見た目。 */
export type TemplateTextLook = {
  fontFamily?: CaptionFontFamily;
  color: string;
  strokeColor?: string;
  strokeWidthPx?: number;
  /** 文字の後ろの帯の色(帯が無ければ省く)。 */
  bandColor?: string;
  /** 文字の周りの光(にじみ)の色。 */
  glowColor?: string;
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

/** 強調した字幕の見た目の1種類。手本に何種類かある時は、役割(何を言う時に使うか)ごとに持つ。 */
export type TemplateEmphasisStyle = {
  /** どんな字幕に使うか(例「比べた結果、選ばれた方の名前」「強い言葉・決め台詞」)。AIが字幕ごとに選ぶ時に見る。 */
  role: string;
  fontFamily: CaptionFontFamily;
  textColor: string;
  bandColor: string | null;
  strokeColor?: string;
  glowColor?: string;
  /** 基本の字幕に対する文字の大きさ(倍)。完全模倣で手本から測った時だけ。無ければ描く部品の決まった倍率。 */
  scale?: number;
  /** 縁の外側にもう1本ある、くっきりした線の色と太さ(横1080pxでのpx)。完全模倣で手本から測った時だけ。 */
  outerStroke?: { color: string; widthPx: number };
  /** 完全模倣だけ: 手本から測った、この強調が出る時の動き。 */
  animation?: CaptionAnimation;
  /** 完全模倣だけ: この強調で寄る時に鳴らす、手本から切り出した効果音の id(手本で鳴っていなければ無し)。 */
  sound?: string;
};

export type ReferenceTemplate = {
  /** 型の名前(手本の名前)。 */
  name: string;
  /** この型を使う手本(保存した手本のファイル名から拡張子を除いた物。YouTubeは動画のID)。 */
  referenceIds: string[];
  /** 出し方: ranking=枠を縦に並べて項目を入れていく、compare=カードを横に並べて比べる、none=タイトルだけ。 */
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
    /** 完全模倣だけ: 手本から測った、ふつうの字幕が出る時の動き。 */
    animation?: CaptionAnimation;
    /** 完全模倣だけ: 手本から測った、ふつうの字幕の縁の太さの倍率と影(CSSの text-shadow)。 */
    strokeScale?: number;
    textShadow?: string;
  };
  /** 強調した字幕の見た目(1つ目がふだん使う物。手本に何種類かあれば役割ごとに)。 */
  emphasisStyles: TemplateEmphasisStyle[];
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
    /** 言い回しの型(例「1行目に話題、2行目に問いかけ」)。手本の文言は持ち込まず、言い回しの形だけまねる。 */
    wording?: string;
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
    /** AIが数を決められなかった時の枠の数。 */
    defaultCount: number;
    shape: TemplateShape;
    /** 番号。{n}を番号に置き換える(例「{n}位」)。枠の左下に置く。looks は順位ごとの見た目(足りない順位は最後の見た目)。 */
    number: { format: string; fontSizePx: number; looks: TemplateTextLook[] };
    /** 枠の中身: image=項目の絵・写真を枠いっぱいに入れる、text=項目名の文字を入れる。 */
    content: "image" | "text";
    /** 項目名の文字(content=text の時と、合う画像が無かった時に使う)。 */
    label: { fontSizePx: number; look: TemplateTextLook };
    /** 項目を言った時に、まずこの所に大きく出してから、縮みながら枠へ入る(無ければ、いきなり枠に出す)。 */
    popup?: TemplateBox & { seconds: number; name?: { fontSizePx: number; look: TemplateTextLook; yPercent: number } };
  };
  /** 横に並べて比べるカード(kind=compare)。カードの数は話の内容で決め、この範囲に等しい幅で並べる。 */
  compare?: {
    row: { yPercent: number; heightPercent: number; leftPercent: number; rightPercent: number; gapPercent: number };
    shape: TemplateShape;
    /** カードの中身: image=比べる物の絵(名前の上)、text=話題ごとの中身の文字、none=名前だけ。 */
    content: "image" | "text" | "none";
    /** 比べる物の名前(カードの下の方。カードの下端からこの%だけ上に、文字の中心を置く)。 */
    name: { fontSizePx: number; look: TemplateTextLook; fromBottomPercent: number };
    /** 話題ごとの中身の文字(content=text の時)。 */
    contentText?: { fontSizePx: number; look: TemplateTextLook };
    /** 今の話題の見出し(カードの上。話題ごとに入れ替わる)。 */
    topic?: { xPercent: number; yPercent: number; fontSizePx: number; look: TemplateTextLook };
    /** 選ばれた方のカードの絵に重ねる丸(話題ごとに、どちらが良いか言い切った時だけ、その字幕の間だけ出す)。 */
    marker?: { color: string; strokeWidthPx: number };
  };
  /** 最後の一言(予約への案内など)。文言は動画ごとにAIが決める。 */
  cta?: { xPercent: number; yPercent: number; fontSizePx: number; look: TemplateTextLook; seconds: number; maxWidthPercent: number };
  /** 完全模倣だけ: 締めの段(手本の終わりに、ふつうの字幕の後に続く見た目の違う字幕を、出た順に。最後の段に動画ごとの最後の一言を入れる)。 */
  ctaStages?: { text: string; look: TemplateTextLook; yPercent: number; seconds: number; fontSizePx?: number }[];
  /** 完全模倣だけ: 手本から切り出した効果音(id は「exact:<置き場所>」、label は音の感じ)。 */
  sounds?: { id: string; label: string }[];
  /** 完全模倣だけ: 手本で、画面が切り替わらずに続いたいちばん長い秒数(画面から測定)。これより長く続く所に寄りを入れる。 */
  longestShotSeconds?: number;
  /** 完全模倣だけ: 手本の、10秒あたりの画面の切り替わりの回数(画面から測定)。 */
  changesPerTenSeconds?: number;
  /** 完全模倣だけ: 生成で、寄り以外(字幕・強調の出入り)で切り替わりと数えられる、10秒あたりの回数(生成を測った値)。 */
  otherChangesPerTenSeconds?: number;
  /** 完全模倣だけ: 締めに入る時に鳴らす、手本から切り出した効果音の id。 */
  closingSound?: string;
  /** 手本で、見出し・次の項目・写真が出るたびに毎回同じに鳴らしていた効果音の id(手本から切り出した物)。 */
  structureSound?: string;
  /** 完全模倣だけ: 手本から測った寄りの倍率(手本では、寄るのは強調の字幕の時だけだった)。 */
  zoomScale?: number;
  /** 完全模倣だけ: 手本から取り出したBGM(置き場所と、声に対する音量)。 */
  bgm?: { src: string; volume: number };
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
export const fitFontSize = (texts: { text: string; look: TemplateTextLook }[], base: number, maxWidthPercent: number, min = 28) => {
  const maxWidthPx = (maxWidthPercent / 100) * VIDEO_WIDTH;
  const longest = Math.max(1, ...texts.map(({ text, look }) => widthEm(text, look)));
  return Math.max(min, Math.min(base, Math.floor(maxWidthPx / longest)));
};

export const textOverlay = (
  text: string,
  look: TemplateTextLook,
  at: { xPercent: number; yPercent: number; fontSizePx: number }
): TextOverlay => ({
  text,
  startOffsetSeconds: 0,
  xPercent: round2(at.xPercent),
  yPercent: round2(at.yPercent),
  fontSizePx: Math.round(Math.min(220, Math.max(20, at.fontSizePx))),
  color: look.color,
  ...(look.strokeColor ? { strokeColor: look.strokeColor } : {}),
  ...(look.strokeColor ? { strokeWidthPx: look.strokeWidthPx ?? Math.max(3, Math.round(at.fontSizePx * 0.08)) } : {}),
  ...(look.bandColor ? { backgroundColor: look.bandColor } : {}),
  ...(look.glowColor ? { glowColor: look.glowColor } : {}),
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

const imageOf = (src: string, box: TemplateBox, extra: Partial<ImageOverlay> = {}): ImageOverlay => ({
  src,
  startOffsetSeconds: 0,
  xPercent: round2(box.xPercent),
  yPercent: round2(box.yPercent),
  widthPercent: round2(Math.max(5, box.widthPercent)),
  heightPercent: round2(Math.max(2, box.heightPercent)),
  rotationDeg: 0,
  cornerRadiusPx: 0,
  animation: "pop",
  fit: "contain",
  ...extra,
});

/** 文字の高さ(%)。 */
export const lineStepPercent = (fontSizePx: number) => ((fontSizePx * LINE_HEIGHT) / VIDEO_HEIGHT) * 100;

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

/** 比べるカードの箱(左から順)。手本の並べ方の範囲に、数に合わせて等しい幅で並べる。 */
export const templateCardBoxes = (compare: NonNullable<ReferenceTemplate["compare"]>, count: number): TemplateBox[] => {
  const n = Math.max(2, Math.min(4, count));
  const { row } = compare;
  const width = (row.rightPercent - row.leftPercent - row.gapPercent * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    xPercent: row.leftPercent + width / 2 + i * (width + row.gapPercent),
    yPercent: row.yPercent,
    widthPercent: width,
    heightPercent: row.heightPercent,
  }));
};

/** カードの中で、名前の文字の中心の高さ(%)と、その上の絵を入れる所。 */
const cardInside = (compare: NonNullable<ReferenceTemplate["compare"]>, card: TemplateBox, nameSize: number) => {
  const top = card.yPercent - card.heightPercent / 2;
  const nameY = card.yPercent + card.heightPercent / 2 - compare.name.fromBottomPercent;
  const nameHalf = ((nameSize * 0.7) / VIDEO_HEIGHT) * 100;
  const imageTop = top + card.heightPercent * 0.06;
  const imageBottom = nameY - nameHalf - card.heightPercent * 0.03;
  const image: TemplateBox = {
    xPercent: card.xPercent,
    yPercent: (imageTop + imageBottom) / 2,
    widthPercent: card.widthPercent * 0.86,
    heightPercent: Math.max(2, imageBottom - imageTop),
  };
  return { nameY, image };
};

/** その動画で使う出し方(工程8で、話の内容が手本と合わなかった時は none にしてある)。 */
export const effectiveKind = (state: Pick<StepState, "templateKind">, template: ReferenceTemplate): ReferenceTemplate["kind"] =>
  state.templateKind ?? template.kind;

/**
 * 8. 型どおりに、タイトル(と帯)・ランキングの枠と番号・比べるカードを置く。
 * 文言(タイトル)と数(枠・カードの数)だけが動画ごとに変わる。
 */
export const buildTemplateObjects = (params: {
  template: ReferenceTemplate;
  title: string;
  frameCount: number;
  /** 話の内容に合わせた出し方(手本と違う時は none)。省略時は手本どおり。 */
  kind?: ReferenceTemplate["kind"];
}): { globalOverlays: TextOverlay[]; globalShapes: ShapeOverlay[] } => {
  const { template } = params;
  const kind = params.kind ?? template.kind;
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

  if (kind === "ranking" && template.frames) {
    const frames = template.frames;
    const count = Math.min(10, Math.max(2, params.frameCount >= 2 ? params.frameCount : frames.defaultCount));
    const boxes = templateFrameBoxes(frames, count);
    boxes.forEach((box, index) => {
      shapes.push(shapeOf(box, frames.shape));
      const label = frames.number.format.replace("{n}", String(index + 1));
      const look = frames.number.looks[Math.min(index, frames.number.looks.length - 1)];
      const size = Math.min(frames.number.fontSizePx, Math.round((box.heightPercent / 100) * VIDEO_HEIGHT * 0.4));
      const width = (widthEm(label, look) * size * 100) / VIDEO_WIDTH;
      const left = box.xPercent - box.widthPercent / 2;
      const bottom = box.yPercent + box.heightPercent / 2;
      overlays.push(
        textOverlay(label, look, {
          xPercent: left + 1.5 + width / 2,
          yPercent: bottom - ((size * 0.65) / VIDEO_HEIGHT) * 100 - 0.4,
          fontSizePx: size,
        })
      );
    });
  }
  if (kind === "compare" && template.compare) {
    const compare = template.compare;
    for (const card of templateCardBoxes(compare, params.frameCount)) shapes.push(shapeOf(card, compare.shape));
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
    // 手本から測った縁の太さ・影(測った型にだけある)
    ...(template.caption.strokeScale ? { strokeScale: template.caption.strokeScale } : {}),
    ...(template.caption.textShadow ? { textShadow: template.caption.textShadow } : {}),
  },
});

/** 完成の動画で、各項目を出し始める時刻(秒)。言い始めのクリップが外されていたら、その後の最初のクリップから。 */
export const fillStartSeconds = (state: StepState): ((fill: Pick<FrameFill, "key" | "sourceSeconds">) => number | undefined) => {
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

/** その字幕(と、カットの切れ目の後に同じ字幕が続くクリップ。出し直しの動きをしない物)を出している長さ(秒)。 */
const captionSeconds = (state: StepState, key: string): number => {
  const index = state.segments.findIndex((segment) => segment.key === key);
  if (index < 0) return 1;
  let total = state.segments[index].durationInSeconds;
  for (
    let i = index + 1;
    i < state.segments.length && state.segments[i].caption === state.segments[index].caption && state.segments[i].captionAnimation === "none";
    i++
  ) {
    total += state.segments[i].durationInSeconds;
  }
  return total;
};

/** 比べるカードで、見出し(今の話題)を入れる番号。カードの番号(1〜)と重ならないよう、大きな番号にする。 */
export const TOPIC_FRAME = 9;

/** 動画の長さ(秒)。 */
const totalSeconds = (state: StepState) => state.segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0);

/**
 * 10・12・14. 型どおりに、枠・カードへ項目を入れ、丸・最後の一言を置く(前に入れた物は外して入れ直す)。
 * ランキング: 項目を言った時に、手本どおり大きく出してから枠へ入れる(絵が無ければ項目名の文字)。
 * 比べる: カードの下に名前、その上に比べる物の絵(か話題ごとの中身の文字)、カードの上に今の話題の見出し、
 * 選ばれた方の絵に丸(言い切った字幕の間だけ)。
 */
export const placeTemplateFills = (state: StepState, template: ReferenceTemplate): StepState => {
  const base = state.globalOverlays.filter((overlay) => overlay.tag !== TEMPLATE_FILL_TAG);
  const fills = state.frameFills ?? [];
  const kind = effectiveKind(state, template);
  const startOf = fillStartSeconds(state);
  const imageOfLabel = (label: string) => state.fillImageSrcs?.[label];
  const texts: TextOverlay[] = [];
  const images: ImageOverlay[] = [];
  const marks: ShapeOverlay[] = [];
  const tagged = (overlay: TextOverlay, start: number, end?: number): TextOverlay => ({
    ...overlay,
    startOffsetSeconds: round2(start),
    ...(end !== undefined && end - start >= 0.2 ? { durationInSeconds: round2(end - start) } : {}),
    animation: "pop",
    tag: TEMPLATE_FILL_TAG,
  });
  const placed = fills
    .map((fill) => ({ fill, start: startOf(fill) }))
    .filter((item): item is { fill: FrameFill; start: number } => item.start !== undefined)
    .sort((a, b) => a.start - b.start);
  const rects = state.globalShapes.filter((shape) => shape.kind === "rect" && !shape.decorative);

  if (kind === "ranking" && template.frames) {
    const frames = template.frames;
    for (const { fill, start } of placed) {
      const rect = rects[fill.frame - 1];
      if (!rect) continue;
      const src = frames.content === "image" ? imageOfLabel(fill.label) : undefined;
      if (src) {
        // 枠の線(線だけの図形は画像の上に描かれる)の内側に、枠いっぱいに収める
        const inFrame = imageOf(src, rect, { fit: "cover", cornerRadiusPx: frames.shape.cornerRadiusPx });
        const popup = frames.popup;
        if (popup) {
          images.push(imageOf(src, popup, { startOffsetSeconds: round2(start), durationInSeconds: popup.seconds, cornerRadiusPx: frames.shape.cornerRadiusPx, fit: "cover" }));
          images.push({
            ...inFrame,
            startOffsetSeconds: round2(start + popup.seconds),
            moveFrom: { xPercent: popup.xPercent, yPercent: popup.yPercent, widthPercent: popup.widthPercent, heightPercent: popup.heightPercent },
          });
          if (popup.name) {
            const size = fitFontSize([{ text: fill.label, look: popup.name.look }], popup.name.fontSizePx, Math.max(30, popup.widthPercent + 4));
            texts.push(tagged(textOverlay(fill.label, popup.name.look, { xPercent: popup.xPercent, yPercent: popup.name.yPercent, fontSizePx: size }), start, start + popup.seconds));
          }
        } else {
          images.push({ ...inFrame, startOffsetSeconds: round2(start) });
        }
        continue;
      }
      const label = frames.label;
      const size = Math.min(
        fitFontSize([{ text: fill.label, look: label.look }], label.fontSizePx, rect.widthPercent - 6, 24),
        Math.round((rect.heightPercent / 100) * VIDEO_HEIGHT * 0.35)
      );
      texts.push(tagged(textOverlay(fill.label, label.look, { xPercent: rect.xPercent, yPercent: rect.yPercent - rect.heightPercent * 0.1, fontSizePx: size }), start));
    }
  }

  if (kind === "compare" && template.compare) {
    const compare = template.compare;
    const byFrame = new Map<number, { fill: FrameFill; start: number }[]>();
    for (const item of placed) byFrame.set(item.fill.frame, [...(byFrame.get(item.fill.frame) ?? []), item]);
    const cards = rects.map((rect) => ({ xPercent: rect.xPercent, yPercent: rect.yPercent, widthPercent: rect.widthPercent, heightPercent: rect.heightPercent }));
    const names = cards.map((_, index) => byFrame.get(index + 1)?.[0]);
    // 名前の文字の大きさは、カード同士でそろえる
    const nameSize = Math.min(
      ...cards.map((card, index) => {
        const name = names[index];
        return name ? fitFontSize([{ text: name.fill.label, look: compare.name.look }], compare.name.fontSizePx, card.widthPercent - 4) : compare.name.fontSizePx;
      })
    );
    const topicStarts = (byFrame.get(TOPIC_FRAME) ?? []).map((item) => item.start);
    cards.forEach((card, index) => {
      const name = names[index];
      if (!name) return;
      const inside = cardInside(compare, card, nameSize);
      // 名前と絵は、手本と同じく、カードが出た時から入れておく(言った時に出すと、それまでカードが空になる)
      const shown = Math.min(name.start, rects[index].startOffsetSeconds ?? 0);
      texts.push(tagged(textOverlay(name.fill.label, compare.name.look, { xPercent: card.xPercent, yPercent: inside.nameY, fontSizePx: nameSize }), shown));
      const src = compare.content === "image" ? imageOfLabel(name.fill.label) : undefined;
      if (src) images.push(imageOf(src, inside.image, { startOffsetSeconds: round2(shown) }));
      const contents = (byFrame.get(index + 1) ?? []).slice(1);
      if (compare.content !== "text" || !compare.contentText || contents.length === 0) return;
      const contentText = compare.contentText;
      const contentSize = fitFontSize(contents.map((item) => ({ text: item.fill.label, look: contentText.look })), contentText.fontSizePx, card.widthPercent - 6);
      // 中身は、次の中身が出るか、話題の見出しが次へ変わった時に消す(前の話題の中身が残らないように)
      contents.forEach((item, i) => {
        const nextTopic = topicStarts.find((start) => start > item.start + 0.2);
        const ends = [contents[i + 1]?.start, nextTopic].filter((value): value is number => value !== undefined);
        texts.push(
          tagged(
            textOverlay(item.fill.label, contentText.look, { xPercent: card.xPercent, yPercent: inside.image.yPercent, fontSizePx: contentSize }),
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
        texts.push(tagged(textOverlay(item.fill.label, topic.look, { xPercent: topic.xPercent, yPercent: topic.yPercent, fontSizePx: size }), item.start, topics[index + 1]?.start));
      });
    }
    // 選ばれた方の丸: 言い切った字幕を出している間だけ、そのカードの絵(名前の上)に重ねる
    if (compare.marker) {
      const marker = compare.marker;
      for (const mark of state.templateMarks ?? []) {
        const card = cards[mark.frame - 1];
        const start = startOf(mark);
        if (!card || start === undefined) continue;
        const inside = cardInside(compare, card, nameSize);
        const diameterPx = Math.min((card.widthPercent / 100) * VIDEO_WIDTH * 0.8, (inside.image.heightPercent / 100) * VIDEO_HEIGHT * 1.15);
        marks.push({
          kind: "circle",
          startOffsetSeconds: round2(start),
          durationInSeconds: round2(Math.max(0.6, captionSeconds(state, mark.key))),
          xPercent: round2(inside.image.xPercent),
          yPercent: round2(inside.image.yPercent),
          widthPercent: round2((diameterPx / VIDEO_WIDTH) * 100),
          heightPercent: round2((diameterPx / VIDEO_HEIGHT) * 100),
          borderColor: marker.color,
          borderWidthPx: marker.strokeWidthPx,
          fillOpacity: 1,
          cornerRadiusPx: 0,
          animation: "pop",
          decorative: true,
        });
      }
    }
  }

  // 最後の一言: 動画の終わりの手本と同じ秒数だけ、手本と同じ所に出す
  const cta = template.cta;
  const ctaText = state.templateCta?.trim();
  if (cta && ctaText) {
    const end = totalSeconds(state);
    const start = Math.max(0, end - cta.seconds);
    const lines = ctaText.split("\n").map((line) => line.trim()).filter(Boolean);
    const size = fitFontSize(lines.map((text) => ({ text, look: cta.look })), cta.fontSizePx, cta.maxWidthPercent);
    lines.forEach((line, index) => {
      const offset = index - (lines.length - 1) / 2;
      texts.push(tagged(textOverlay(line, cta.look, { xPercent: cta.xPercent, yPercent: cta.yPercent + offset * lineStepPercent(size), fontSizePx: size }), start));
    });
  }

  return { ...state, globalOverlays: [...base, ...texts], templateImages: images, templateShapes: marks };
};

/**
 * 型に手本から切り出した効果音がある時(手本を測って作った型)、効果音を手本どおりにする(工程11。sfxPlan.ts で置いた後)。
 * - 強調の字幕の音(isEmphasisSound の音)は、その見た目の種類で手本が鳴らしていた音にする。手本で鳴っていなかった種類は鳴らさない
 * - 見出し・次の項目の音は、手本で毎回同じに鳴らしていた音(structureSound)があればそれにする
 * - 締めの音は、手本の締めの音があればそれにする
 * 手本の音が型に無い時は、そのまま(編集チームの効果音)。
 */
export const templateSounds = (
  state: StepState,
  template: ReferenceTemplate,
  sounds: { isEmphasisSound: (id: string) => boolean; stepSound: string; endingSound: string }
): StepState["segments"] => {
  const segments = state.segments;
  const hasStyleSounds = template.emphasisStyles.some((style) => style.sound);
  if (!hasStyleSounds && !template.closingSound && !template.structureSound) return segments;
  return segments.map((segment) => {
    const id = segment.emphasisSfxPresetId;
    if (!id) return segment;
    if (id === sounds.endingSound && template.closingSound) return { ...segment, emphasisSfxPresetId: template.closingSound };
    if (id === sounds.stepSound && template.structureSound) return { ...segment, emphasisSfxPresetId: template.structureSound };
    if (!hasStyleSounds || !sounds.isEmphasisSound(id)) return segment;
    const color = segment.captionEmphasis?.textColor?.toUpperCase();
    const style = template.emphasisStyles.find((candidate) => candidate.textColor.toUpperCase() === color);
    return { ...segment, emphasisSfxPresetId: style?.sound };
  });
};
