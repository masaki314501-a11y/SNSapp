/**
 * 完全模倣(EC-6): 型どおりに置いた物(src/lib/editSteps/template.ts の placeTemplateFills)の出し方を、手本に合わせて直す。
 * 共通の部品は変えず、置いた後の画像・文字の秒数だけを直す。
 */
import type { ImageOverlay, ShapeOverlay, TextOverlay } from "@video/shared/schema";
import type { StepState } from "@/lib/editSteps/logic";
import { fitFontSize, lineStepPercent, TEMPLATE_FILL_TAG, textOverlay, type ReferenceTemplate } from "@/lib/editSteps/template";

/** 最後の項目の大きな写真を出しておく、いちばん長い秒数。 */
const LAST_HOLD_SECONDS = 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * ランキングで、項目を言った時に大きく出す写真と名前を、次の項目が出るまで出したままにし、次の項目が出た時に枠へ入れる
 * (手本では、その項目の話をしている間ずっと大きく出していて、次の項目が出た時に前の写真が枠へ入っていた)。
 * totalSeconds は動画の長さ。
 */
export const holdPopups = (state: StepState, template: ReferenceTemplate, totalSeconds: number): StepState => {
  const popup = template.frames?.popup;
  if (!popup) return state;
  const images = state.templateImages ?? [];
  const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const isPopup = (image: ImageOverlay) =>
    !image.moveFrom && same(image.xPercent, popup.xPercent) && same(image.yPercent, popup.yPercent) && same(image.widthPercent, popup.widthPercent);
  const popups = images.filter(isPopup).sort((a, b) => (a.startOffsetSeconds ?? 0) - (b.startOffsetSeconds ?? 0));
  if (popups.length === 0) return state;
  const holdOf = new Map<number, number>();
  popups.forEach((image, index) => {
    const start = image.startOffsetSeconds ?? 0;
    const next = popups[index + 1]?.startOffsetSeconds;
    const hold = next !== undefined ? next - start : Math.min(LAST_HOLD_SECONDS, Math.max(popup.seconds, totalSeconds - start - 0.3));
    holdOf.set(round2(start), Math.max(popup.seconds, round2(hold)));
  });
  const holdFrom = (start: number) => holdOf.get(round2(start));
  const nextImages = images.map((image) => {
    if (isPopup(image)) {
      const hold = holdFrom(image.startOffsetSeconds ?? 0);
      return hold ? { ...image, durationInSeconds: hold } : image;
    }
    // 枠へ入る写真は、元の大きな写真の出始め + 出していた秒数 から動き出す
    if (image.moveFrom && same(image.moveFrom.xPercent, popup.xPercent) && same(image.moveFrom.yPercent, popup.yPercent)) {
      const popupStart = round2((image.startOffsetSeconds ?? 0) - popup.seconds);
      const hold = holdFrom(popupStart);
      return hold ? { ...image, startOffsetSeconds: round2(popupStart + hold) } : image;
    }
    return image;
  });
  const nameY = popup.name?.yPercent;
  const nextOverlays = state.globalOverlays.map((overlay: TextOverlay) => {
    if (overlay.tag !== TEMPLATE_FILL_TAG || nameY === undefined || !same(overlay.yPercent, nameY) || !same(overlay.xPercent, popup.xPercent)) return overlay;
    const hold = holdFrom(overlay.startOffsetSeconds ?? 0);
    return hold ? { ...overlay, durationInSeconds: hold } : overlay;
  });
  return { ...state, templateImages: nextImages, globalOverlays: nextOverlays };
};

/**
 * タイトルの帯を、手本と同じ透け方にする(EC-6)。型どおりに置いた帯(画面の端から端までの飾りの四角)の塗りの濃さを、
 * 手本から測った透けない度合いにする。測れていなければそのまま。
 */
export const withBandOpacity = <T extends { globalShapes: ShapeOverlay[] }>(built: T, template: ReferenceTemplate): T => {
  const band = template.title.band as (NonNullable<ReferenceTemplate["title"]["band"]> & { opacity?: number }) | undefined;
  if (!band || band.opacity === undefined || band.opacity >= 1) return built;
  return {
    ...built,
    globalShapes: built.globalShapes.map((shape) =>
      shape.decorative && shape.widthPercent >= 99 && shape.fillColor?.toUpperCase() === band.color.toUpperCase() ? { ...shape, fillOpacity: band.opacity } : shape
    ),
  };
};

/**
 * 先生の映り方を手本に合わせる拡大(EC-7)。顔の大きさの比で倍率を決め(1〜2倍)、顔が手本の位置に来るよう拡大の中心を決める。
 * 今までの決め方(framingToMatch)は、顔の大きさが同じでも必ず1.15倍以上に拡大していたので、先生が手本より大きく映った。
 * 拡大しかできないので、位置を動かしたい時だけ、届くのに要る分まで倍率を上げる(1.3倍まで)。
 */
export const framingExact = (
  face: { xPercent: number; yPercent: number; heightPercent: number },
  target: { xPercent: number; yPercent: number; heightPercent: number }
): { scale: number; focusXPercent: number; focusYPercent: number } | null => {
  const bySize = target.heightPercent / Math.max(1, face.heightPercent);
  const reach = (position: number, goal: number) =>
    goal > position ? goal / Math.max(1, position) : goal < position ? (100 - goal) / Math.max(1, 100 - position) : 1;
  const byPosition = Math.min(1.3, Math.max(reach(face.xPercent, target.xPercent), reach(face.yPercent, target.yPercent)));
  const scale = Math.min(2, Math.max(1, bySize, Math.abs(face.xPercent - target.xPercent) > 3 || Math.abs(face.yPercent - target.yPercent) > 3 ? byPosition : 1));
  if (scale < 1.02) return null;
  const focus = (position: number, goal: number) => Math.min(100, Math.max(0, (scale * position - goal) / (scale - 1)));
  return { scale: round2(scale), focusXPercent: round2(focus(face.xPercent, target.xPercent)), focusYPercent: round2(focus(face.yPercent, target.yPercent)) };
};

/**
 * 完全模倣(A3 締め方): 締め(最後の一言・締めの段)が出ている間は、ふつうの字幕・話題の見出し・丸を出さない
 * (手本では、締めの字幕は字幕の所に出て、その間は字幕も見出しも出ていなかった。動画の上のタイトルと、カードとその中身は出したまま)。
 * 締めの始まりにかかる字幕は、言いかけで消えないよう、まるごと出さない。
 */
export const clearUnderCta = (state: StepState, template: ReferenceTemplate, totalSeconds: number): StepState => {
  const cta = template.cta;
  if (!cta) return state;
  const planned = round2(Math.max(0, totalSeconds - cta.seconds));
  // 最後の一言の文字(型の最後の一言と同じ色で、終わりの近くから、型の位置の近くに出ている物。動画の長さの数え方で、出始めは少しずれる)
  const isCta = (overlay: TextOverlay) =>
    overlay.tag === CTA_STAGE_TAG ||
    (overlay.tag === TEMPLATE_FILL_TAG &&
      Math.abs((overlay.startOffsetSeconds ?? 0) - planned) < 1 &&
      String(overlay.color ?? "").toUpperCase() === cta.look.color.toUpperCase() &&
      Math.abs(overlay.yPercent - cta.yPercent) < 15);
  const ctaTexts = state.globalOverlays.filter(isCta);
  if (ctaTexts.length === 0) return state;
  const start = round2(Math.min(...ctaTexts.map((overlay) => overlay.startOffsetSeconds ?? planned)));
  let at = 0;
  const segments = state.segments.map((segment) => {
    const end = at + segment.durationInSeconds;
    at = end;
    return end > start + 0.05 && segment.caption.trim() ? { ...segment, caption: "", captionEmphasis: undefined } : segment;
  });
  const endAt = <T extends { startOffsetSeconds?: number; durationInSeconds?: number }>(item: T): T | null => {
    const from = item.startOffsetSeconds ?? 0;
    if (from >= start - 0.01) return null;
    const to = item.durationInSeconds !== undefined ? from + item.durationInSeconds : Infinity;
    return to > start ? { ...item, durationInSeconds: round2(start - from) } : item;
  };
  // 話題の見出し(型の見出しの位置にある、型どおりに置いた文字)
  const topicY = template.compare?.topic?.yPercent;
  const isTopic = (overlay: TextOverlay) => overlay.tag === TEMPLATE_FILL_TAG && topicY !== undefined && Math.abs(overlay.yPercent - topicY) < 2;
  const globalOverlays = state.globalOverlays.flatMap((overlay) => {
    if (isCta(overlay) && overlay.tag !== CTA_STAGE_TAG) return [{ ...overlay, startOffsetSeconds: start, durationInSeconds: round2(totalSeconds - start) }];
    if (!isTopic(overlay)) return [overlay];
    const kept = endAt(overlay);
    return kept ? [kept] : [];
  });
  const templateShapes = state.templateShapes?.flatMap((shape) => {
    const kept = endAt(shape);
    return kept ? [kept] : [];
  });
  return { ...state, segments, globalOverlays, templateShapes };
};

/**
 * 締めの段の行。改行があればそのまま。無くて、1行では字が型の大きさの8割未満に縮む時は、
 * 真ん中に近い助詞(は・から・を・に・で・が)の後ろで2行に分ける(手本の締めは「カウンセリングは/無料ですか?」のように2行)。
 */
export const linesOf = (text: string, fits: (line: string) => boolean): string[] => {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || fits(lines[0])) return lines;
  const chars = [...lines[0]];
  let best: number | null = null;
  for (const particle of ["から", "は", "を", "に", "で", "が"]) {
    for (let at = lines[0].indexOf(particle); at >= 0; at = lines[0].indexOf(particle, at + 1)) {
      const cut = [...lines[0].slice(0, at + particle.length)].length;
      if (cut < chars.length * 0.3 || cut > chars.length * 0.7) continue;
      if (best === null || Math.abs(cut - chars.length / 2) < Math.abs(best - chars.length / 2)) best = cut;
    }
  }
  const cut = best ?? Math.ceil(chars.length / 2);
  return [chars.slice(0, cut).join(""), chars.slice(cut).join("")];
};

/** 締めの段の文字の目印(clearUnderCta が締めの始まりを見分けるため)。 */
export const CTA_STAGE_TAG = "exact-cta-stage";

/**
 * 完全模倣(A3・J91・J92 締め方): 手本の終わりの「締めの段」(例: 問いかけ → 無料の案内 → 予約の案内)を、
 * 手本と同じ順番・長さ・見た目・位置で、動画の終わりに出す。最後の段は、この動画の最後の一言(finalText)。
 * 前の段は、手本の文言のまま(同じ医院の案内)。型に締めの段が無ければ、何もしない。
 */
export const placeCtaStages = (state: StepState, template: ReferenceTemplate, totalSeconds: number, finalText: string | undefined): StepState => {
  const stages = template.ctaStages;
  const cta = template.cta;
  if (!stages || stages.length === 0 || !cta) return state;
  // 改行が「\n」の2文字で入っていたら、本当の改行に直す
  const texts = stages.map((stage, i) => (i === stages.length - 1 && finalText?.trim() ? finalText.trim() : stage.text).replace(/\\n/g, "\n"));
  const total = stages.reduce((sum, stage) => sum + stage.seconds, 0);
  // 締めの始まりは、近い方の字幕の切れ目に合わせる(字幕の途中から始めると、その字幕を消すしかなく、何も出ない間ができる)。
  // ずれた分は1段目の長さで合わせる(1段目は最低0.8秒)
  const planned = Math.max(0, totalSeconds - total);
  const cuts: number[] = [];
  let edge = 0;
  for (const segment of state.segments) {
    cuts.push(round2(edge));
    edge += segment.durationInSeconds;
  }
  const lastStart = totalSeconds - (total - stages[0].seconds) - 0.8;
  const candidates = cuts.filter((cut) => cut <= lastStart + 0.05);
  const snapped = candidates.length > 0 ? candidates.reduce((best, cut) => (Math.abs(cut - planned) < Math.abs(best - planned) ? cut : best)) : planned;
  const durations = stages.map((stage, i) => (i === 0 ? stage.seconds + (planned - snapped) : stage.seconds));
  let at = snapped;
  const overlays: TextOverlay[] = stages.flatMap((stage, i) => {
    const base = stage.fontSizePx ?? cta.fontSizePx;
    const lines = linesOf(texts[i], (text) => fitFontSize([{ text, look: stage.look }], base, cta.maxWidthPercent) >= base * 0.8);
    const size = fitFontSize(lines.map((text) => ({ text, look: stage.look })), base, cta.maxWidthPercent);
    const start = round2(at);
    at += durations[i];
    const duration = round2(i === stages.length - 1 ? totalSeconds - start : durations[i]);
    return lines.map((line, index) => ({
      ...textOverlay(line, stage.look, { xPercent: cta.xPercent, yPercent: stage.yPercent + (index - (lines.length - 1) / 2) * lineStepPercent(size), fontSizePx: size }),
      startOffsetSeconds: start,
      durationInSeconds: duration,
      // 手本の締めの字幕は、ぱっと出る
      animation: "none",
      tag: CTA_STAGE_TAG,
    }));
  });
  // 型どおりの最後の一言(1つだけの物)は外して、締めの段に置き換える
  const oldCtaStart = Math.max(0, totalSeconds - cta.seconds);
  const isOldCta = (overlay: TextOverlay) =>
    overlay.tag === TEMPLATE_FILL_TAG &&
    Math.abs((overlay.startOffsetSeconds ?? 0) - oldCtaStart) < 1 &&
    String(overlay.color ?? "").toUpperCase() === cta.look.color.toUpperCase() &&
    Math.abs(overlay.yPercent - cta.yPercent) < 15;
  return { ...state, globalOverlays: [...state.globalOverlays.filter((overlay) => !isOldCta(overlay) && overlay.tag !== CTA_STAGE_TAG), ...overlays] };
};

/**
 * 完全模倣(グループ2 G61・H81・F55): タイトル・見出し・枠の文字・写真・丸・カードは、手本どおり「ぱっと出る」にする
 * (手本を0.1秒ごとに見ると、冒頭のタイトルは真ん中から左上へいきなり替わり、見出し・丸もいきなり出ていた。
 * 共通の部品は、タイトル・枠を「ふわっと」、写真・見出し・丸を「拡大しながら」と決め打ちしているため、完全模倣ではここで外す)。
 */
export const instantObjects = (state: StepState): StepState => ({
  ...state,
  globalOverlays: state.globalOverlays.map((overlay) => ({ ...overlay, animation: "none" as const })),
  globalShapes: state.globalShapes.map((shape) => ({ ...shape, animation: "none" as const })),
  ...(state.templateImages ? { templateImages: state.templateImages.map((image) => ({ ...image, animation: "none" as const })) } : {}),
  ...(state.templateShapes ? { templateShapes: state.templateShapes.map((shape) => ({ ...shape, animation: "none" as const })) } : {}),
});

/**
 * 完全模倣(グループ2 D35・E46): 字幕ごとの出方を、手本から測った出方にそろえる(最後の工程13で行う)。
 * 前の字幕の続き(カットの切れ目の後)は動きなし。強調は、字の色が同じ強調の種類の出方。ふつうの字幕は、ふつうの字幕の出方。
 * 型に出方が無ければ、ぱっと出る(手本に無い動きは使わない。共通の部品は、動きなしの字幕を「ポップイン」に戻すため、ここでそろえ直す)。
 */
export const measuredMotions = (state: StepState, template: ReferenceTemplate): StepState => ({
  ...state,
  segments: state.segments.map((segment, i, all) => {
    if (!segment.caption.trim()) return segment;
    const continued = i > 0 && all[i - 1].caption === segment.caption;
    if (continued) return { ...segment, captionAnimation: "none" as const };
    const color = segment.captionEmphasis?.textColor?.toUpperCase();
    const style = color ? template.emphasisStyles.find((candidate) => candidate.textColor.toUpperCase() === color) : undefined;
    const animation = (segment.captionEmphasis ? style?.animation : template.caption.animation) ?? "none";
    return { ...segment, captionAnimation: animation };
  }),
});
