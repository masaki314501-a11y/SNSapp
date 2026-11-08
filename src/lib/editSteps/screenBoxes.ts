/**
 * 画面の上で、顔と字幕がどこを占めるかの見積もり(%)。工程7(字幕の位置)・工程8(枠の並べ方)・工程14(セーフティゾーン)で使う。
 * 前の「AIで自動編集」(autoEditPlan.ts。今は消した)から、工程ごとの編集で使う物だけを移した。
 */
import { CAPTION_FONT_SIZE_SCALE, type CaptionFontSize, type CaptionPosition, type CaptionStyle, type ClipZoom, type FaceBox, type VideoFraming } from "@video/shared/schema";
import { VIDEO_HEIGHT, VIDEO_WIDTH } from "@video/shared/constants";
import { breakIntoLines, estimateTextWidthPx, type BoxPercent } from "@video/shared/textWrap";

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** 顔の位置の見積もりの誤差を見込んで、顔の範囲を上下左右に広げる割合。 */
const FACE_MARGIN_RATIO = 0.15;

/**
 * 顔が完成動画の画面のどこに映るか(%)。映像には画角(framing)と寄り(zoom)が付くので、その分だけ動かす
 * (描画側のMediaBackground.tsxと同じ計算。中心の点は動かず、ほかは中心から離れる方向へ広がる)。
 * ゆっくり寄る(slow)クリップは、寄る前と寄った後の両方を含む範囲にする。
 */
export const faceOnScreen = (face: FaceBox, framing: VideoFraming | null, zoom: ClipZoom | undefined): BoxPercent => {
  const halfWidth = (face.widthPercent / 2) * (1 + FACE_MARGIN_RATIO * 2);
  const halfHeight = (face.heightPercent / 2) * (1 + FACE_MARGIN_RATIO * 2);
  const scaleAround = (value: number, focus: number, scale: number) => focus + (value - focus) * scale;
  const project = (zoomScale: number, panOffset = 0): BoxPercent => {
    const toScreen = (x: number, y: number) => {
      let px = zoom ? scaleAround(x, clamp(zoom.focusXPercent + panOffset, 0, 100), zoomScale) : x;
      let py = zoom ? scaleAround(y, zoom.focusYPercent, zoomScale) : y;
      if (framing) {
        px = scaleAround(px, framing.focusXPercent, framing.scale);
        py = scaleAround(py, framing.focusYPercent, framing.scale);
      }
      return { x: px, y: py };
    };
    const topLeft = toScreen(face.xPercent - halfWidth, face.yPercent - halfHeight);
    const bottomRight = toScreen(face.xPercent + halfWidth, face.yPercent + halfHeight);
    return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y };
  };
  const end = project(zoom?.scale ?? 1);
  // ゆっくり寄るなら寄る前から後まで、横に流すなら流す範囲の両端を含める(描画側のPAN_RANGE_PERCENTと同じ幅)
  const box =
    zoom?.style === "slow"
      ? unionBox(project(1), end)
      : zoom?.style === "pan"
        ? unionBox(project(zoom.scale, -15), project(zoom.scale, 15))
        : end;
  return {
    left: clamp(box.left, 0, 100),
    top: clamp(box.top, 0, 100),
    right: clamp(box.right, 0, 100),
    bottom: clamp(box.bottom, 0, 100),
  };
};

const unionBox = (a: BoxPercent, b: BoxPercent): BoxPercent => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

/** テロップの文字の大きさ・余白・画面の端からの距離。描画側(AnimatedCaption.tsx)と同じ値。 */
const CAPTION_BASE_FONT_PX: Record<CaptionStyle, number> = { outline: 48, pill: 44 };
const CAPTION_OFFSET_FROM_EDGE_PX = 160;
// 描画側(AnimatedCaption.tsxのCAPTION_SIDE_PADDING)と同じ。TikTokの右側のボタンにかからない幅
const CAPTION_MAX_WIDTH_PX = VIDEO_WIDTH - 140 * 2;

/** テロップがその位置で画面のどこを占めるかの見積もり(%)。 */
export const captionBox = (text: string, position: CaptionPosition, style: CaptionStyle, fontSize: CaptionFontSize): BoxPercent => {
  const fontPx = CAPTION_BASE_FONT_PX[style] * CAPTION_FONT_SIZE_SCALE[fontSize];
  const padding = style === "pill" ? 32 : 0;
  const lines = breakIntoLines(text || "あ", fontPx, CAPTION_MAX_WIDTH_PX - padding * 2);
  const widthPx = Math.min(CAPTION_MAX_WIDTH_PX, estimateTextWidthPx(lines.join("\n"), fontPx) + padding * 2);
  const heightPercent = ((lines.length * fontPx * 1.35 + padding) / VIDEO_HEIGHT) * 100;
  const edgePercent = (CAPTION_OFFSET_FROM_EDGE_PX / VIDEO_HEIGHT) * 100;
  const top = position === "top" ? edgePercent : position === "middle" ? 50 - heightPercent / 2 : 100 - edgePercent - heightPercent;
  const halfWidth = (widthPx / VIDEO_WIDTH) * 50;
  return { left: 50 - halfWidth, right: 50 + halfWidth, top, bottom: top + heightPercent };
};
