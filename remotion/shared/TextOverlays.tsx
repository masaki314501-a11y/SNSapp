import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { TextOverlay } from "./schema";
import { LINE_STYLE, resolveOverlayLayout } from "./textWrap";
import { resolveFontFamilyStack } from "./schema";
import { ensureCaptionFontLoaded } from "./font";

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

/** moveFromから今の位置へ動く時間(秒)。 */
const MOVE_SECONDS = 0.4;

const OverlayText: React.FC<{ overlay: TextOverlay; fontFamilyStack: string }> = ({ overlay, fontFamilyStack }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const moveFrom = overlay.moveFrom;
  // 動いてくる文字は、出現アニメーションの代わりに位置・大きさの移動で出す。
  const { transform, opacity, clipPath, filter } = moveFrom
    ? { transform: undefined, opacity: undefined, clipPath: undefined, filter: undefined }
    : getCaptionAnimationStyle(overlay.animation, frame, fps);
  const layout = resolveOverlayLayout(overlay);
  const lines = layout.lines;
  const progress = moveFrom
    ? interpolate(frame, [0, Math.max(1, Math.round(MOVE_SECONDS * fps))], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      })
    : 1;
  const lerp = (from: number, to: number) => from + (to - from) * progress;
  const fontSizePx = moveFrom ? lerp(resolveOverlayLayout({ ...overlay, ...moveFrom }).fontSizePx, layout.fontSizePx) : layout.fontSizePx;
  const xPercent = moveFrom ? lerp(moveFrom.xPercent, layout.xPercent) : layout.xPercent;
  const yPercent = moveFrom ? lerp(moveFrom.yPercent, overlay.yPercent) : overlay.yPercent;
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
        top: `${yPercent}%`,
        // 位置は文字の中心で指定させているため、自分の大きさの半分だけ戻して中心を合わせる。
        // 画面端に寄せた指定でもはみ出しにくいよう、最大幅は画面の9割に抑える。
        transform: `translate(-50%, -50%) rotate(${overlay.rotationDeg}deg)`,
        // 位置を画面の右寄りにすると、絶対配置の箱の幅が「右端までの残り」に縮められ、収まる長さの文字でも
        // 途中で折り返されていた。文字の長さぶんの幅を取り、画面の9割を超える時だけ折り返す。
        width: "max-content",
        maxWidth: "90%",
        textAlign: "center",
      }}
    >
      <div style={{ transform, opacity, filter }}>
        <span
          lang="ja"
          style={{
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
            textShadow,
          }}
        >
          {/* 改行位置はresolveOverlayLayoutで決めた物を使い、1行ずつ描く(重なりの見積もりとも一致させる) */}
          {lines.map((line, index) => (
            <span key={index} style={LINE_STYLE}>
              {line}
            </span>
          ))}
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
