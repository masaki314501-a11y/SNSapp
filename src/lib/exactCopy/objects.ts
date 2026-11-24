/**
 * 完全模倣(EC-6): 型どおりに置いた物(src/lib/editSteps/template.ts の placeTemplateFills)の出し方を、手本に合わせて直す。
 * 共通の部品は変えず、置いた後の画像・文字の秒数だけを直す。
 */
import type { ImageOverlay, ShapeOverlay, TextOverlay } from "@video/shared/schema";
import type { StepState } from "@/lib/editSteps/logic";
import { TEMPLATE_FILL_TAG, type ReferenceTemplate } from "@/lib/editSteps/template";

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
