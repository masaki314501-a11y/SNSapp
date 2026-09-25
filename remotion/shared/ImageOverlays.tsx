import React from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import { resolveClipSrc } from "./resolveSrc";
import type { ImageOverlay } from "./schema";

const OverlayImage: React.FC<{ image: ImageOverlay }> = ({ image }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath, filter } = getCaptionAnimationStyle(image.animation, frame, fps);

  return (
    <div
      style={{
        position: "absolute",
        left: `${image.xPercent}%`,
        top: `${image.yPercent}%`,
        width: `${image.widthPercent}%`,
        // 位置は画像の中心で指定させているため、自分の大きさの半分だけ戻して中心を合わせる。
        transform: `translate(-50%, -50%) rotate(${image.rotationDeg}deg)`,
      }}
    >
      <div style={{ transform, opacity, filter, clipPath }}>
        <Img
          src={resolveClipSrc(image.src)}
          style={{ width: "100%", height: "auto", display: "block", borderRadius: image.cornerRadiusPx }}
        />
      </div>
    </div>
  );
};

/**
 * 画面に重ねる画像。表示タイミング(カット先頭/動画先頭からの秒数)ごとにSequenceで区切り、
 * 出現アニメーションはテロップ・強調テキストと同じ仕組み(captionAnimations.ts)を使う。
 * <Img>は読み込み完了まで描画を待つため、書き出しで画像が抜けることがない。
 */
export const ImageOverlays: React.FC<{ images: ImageOverlay[] }> = ({ images }) => {
  const { fps, durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {images
        .filter((image) => image.src)
        .map((image, index) => {
          const from = Math.min(Math.round(image.startOffsetSeconds * fps), Math.max(0, durationInFrames - 1));
          const length =
            image.durationInSeconds !== undefined
              ? Math.max(1, Math.round(image.durationInSeconds * fps))
              : Math.max(1, durationInFrames - from);
          return (
            <Sequence key={index} from={from} durationInFrames={length} layout="none">
              <OverlayImage image={image} />
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
};
