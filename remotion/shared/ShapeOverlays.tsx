import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { ShapeOverlay } from "./schema";

const hexToRgba = (hex: string, alpha: number): string => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((value) => parseInt(value, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const OverlayShape: React.FC<{ shape: ShapeOverlay }> = ({ shape }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath, filter } = getCaptionAnimationStyle(shape.animation, frame, fps);

  return (
    <div
      style={{
        position: "absolute",
        left: `${shape.xPercent}%`,
        top: `${shape.yPercent}%`,
        width: `${shape.widthPercent}%`,
        // 丸は横幅を直径にする(画面の縦横の長さが違うので、高さを%で決めると楕円になる)。
        height: shape.kind === "circle" ? undefined : `${shape.heightPercent}%`,
        aspectRatio: shape.kind === "circle" ? "1 / 1" : undefined,
        // 位置は図形の中心で指定させているため、自分の大きさの半分だけ戻して中心を合わせる。
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          transform,
          opacity,
          filter,
          clipPath,
          border: shape.borderColor ? `${shape.borderWidthPx}px solid ${shape.borderColor}` : undefined,
          borderRadius: shape.kind === "circle" ? "50%" : shape.cornerRadiusPx,
          backgroundColor: shape.fillColor ? hexToRgba(shape.fillColor, shape.fillOpacity) : undefined,
        }}
      />
    </div>
  );
};

/**
 * 画面に重ねる図形(ランキングの空の枠など)。画像の上・文字の下に重ね、枠の中に入れた画像の縁取りとしても見えるようにする。
 * 表示タイミングと出現アニメーションは強調テキスト・画像と同じ仕組み。
 */
export const ShapeOverlays: React.FC<{ shapes: ShapeOverlay[] }> = ({ shapes }) => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {shapes.map((shape, index) => {
        const from = Math.min(Math.round(shape.startOffsetSeconds * fps), Math.max(0, durationInFrames - 1));
        const length =
          shape.durationInSeconds !== undefined
            ? Math.max(1, Math.round(shape.durationInSeconds * fps))
            : Math.max(1, durationInFrames - from);
        return (
          <Sequence key={index} from={from} durationInFrames={length} layout="none">
            <OverlayShape shape={shape} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
