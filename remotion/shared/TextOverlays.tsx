import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { TextOverlay } from "./schema";
import { VIDEO_WIDTH } from "./constants";
import { JAPANESE_WRAP_STYLE, estimateTextWidthPx, fitFontSizeToWidth } from "./textWrap";
import { resolveFontFamilyStack } from "./schema";
import { ensureCaptionFontLoaded } from "./font";

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

/** 明るい色か(白・黄色など)。縁取りも帯も無い明るい文字は、明るい背景や画像の上で読めなくなる。 */
const isLightColor = (hex: string): boolean => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((value) => parseInt(value, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6;
};

type Props = {
  overlays: TextOverlay[];
  fontFamilyStack: string;
};

/**
 * 実際に描く文字の大きさと横位置。編集画面のドラッグ用の枠(PreviewDragLayer.tsx)も同じ位置に出すため公開する。
 */
export const resolveOverlayLayout = (overlay: TextOverlay): { fontSizePx: number; xPercent: number } => {
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

const OverlayText: React.FC<{ overlay: TextOverlay; fontFamilyStack: string }> = ({ overlay, fontFamilyStack }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath, filter } = getCaptionAnimationStyle(overlay.animation, frame, fps);
  const { fontSizePx, xPercent } = resolveOverlayLayout(overlay);
  // この文字だけ書体を変える時は、その書体も読み込む(テロップの書体はテロップ側で読み込まれる)。
  if (overlay.fontFamily) void ensureCaptionFontLoaded(overlay.fontFamily);
  const textShadow = overlay.glowColor
    ? `0 0 ${Math.round(fontSizePx * 0.18)}px ${overlay.glowColor}, 0 0 ${Math.round(fontSizePx * 0.4)}px ${overlay.glowColor}`
    : overlay.backgroundColor
      ? undefined
      : "0 6px 18px rgba(0,0,0,0.55)";
  // 縁取りも帯も無い明るい文字には黒い縁取りを付ける(明るい画像や白い背景の上でも読めるように)。
  const strokeColor =
    overlay.strokeColor ?? (!overlay.backgroundColor && isLightColor(overlay.color) ? "#000000" : undefined);

  return (
    <div
      style={{
        position: "absolute",
        left: `${xPercent}%`,
        top: `${overlay.yPercent}%`,
        // 位置は文字の中心で指定させているため、自分の大きさの半分だけ戻して中心を合わせる。
        // 画面端に寄せた指定でもはみ出しにくいよう、最大幅は画面の9割に抑える。
        transform: `translate(-50%, -50%) rotate(${overlay.rotationDeg}deg)`,
        maxWidth: "90%",
        textAlign: "center",
      }}
    >
      <div style={{ transform, opacity, filter }}>
        <span
          lang="ja"
          style={{
            ...JAPANESE_WRAP_STYLE,
            display: "inline-block",
            clipPath,
            color: overlay.color,
            backgroundColor: overlay.backgroundColor,
            padding: overlay.backgroundColor ? "0.12em 0.4em" : undefined,
            borderRadius: overlay.backgroundColor ? "0.2em" : undefined,
            // 縁取りは文字の内側半分が文字に隠れる(paintOrder: stroke fill)ので、見える太さはこの半分。
            // ショート動画でよく見る「太い縁取り」に合わせ、見える太さが文字の大きさの約8%になるようにする
            // (以前の文字の約3%では細く、完成動画の手本と比べて縁取りがほとんど見えなかった)。
            WebkitTextStroke: strokeColor
              ? `${overlay.strokeWidthPx !== undefined ? overlay.strokeWidthPx * 2 : Math.max(3, Math.round(fontSizePx * 0.16))}px ${strokeColor}`
              : undefined,
            paintOrder: "stroke fill",
            fontFamily: overlay.fontFamily ? resolveFontFamilyStack(overlay.fontFamily) : fontFamilyStack,
            fontStyle: overlay.italic ? "italic" : undefined,
            fontSize: fontSizePx,
            fontWeight: 900,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            textShadow,
          }}
        >
          {overlay.text}
        </span>
      </div>
    </div>
  );
};

/**
 * 字幕とは別に画面へ重ねる強調テキスト。表示タイミング(カット先頭からの秒数)ごとに
 * Sequenceで区切り、出現アニメーションはテロップと同じ仕組み(captionAnimations.ts)を使う。
 */
export const TextOverlays: React.FC<Props> = ({ overlays, fontFamilyStack }) => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {overlays
        .filter((overlay) => overlay.text.trim().length > 0)
        .map((overlay, index) => {
          const from = Math.min(Math.round(overlay.startOffsetSeconds * fps), Math.max(0, durationInFrames - 1));
          const length =
            overlay.durationInSeconds !== undefined
              ? Math.max(1, Math.round(overlay.durationInSeconds * fps))
              : Math.max(1, durationInFrames - from);
          return (
            <Sequence key={index} from={from} durationInFrames={length} layout="none">
              <OverlayText overlay={overlay} fontFamilyStack={fontFamilyStack} />
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
};
