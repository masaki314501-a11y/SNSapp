import React from "react";
import { AbsoluteFill, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import { resolveClipSrc } from "./resolveSrc";
import type { ImageOverlay } from "./schema";

/** moveFromから今の位置へ動く時間(秒)。 */
const MOVE_SECONDS = 0.45;

const OverlayImage: React.FC<{ image: ImageOverlay }> = ({ image }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const moveFrom = image.moveFrom;
  // 動いてくる画像は、出現アニメーションの代わりに位置・大きさの移動で出す。
  const { transform, opacity, clipPath, filter } = moveFrom
    ? { transform: undefined, opacity: undefined, clipPath: undefined, filter: undefined }
    : getCaptionAnimationStyle(image.animation, frame, fps);
  const progress = moveFrom
    ? interpolate(frame, [0, Math.max(1, Math.round(MOVE_SECONDS * fps))], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 1;
  const lerp = (from: number | undefined, to: number) => (from === undefined ? to : from + (to - from) * progress);
  const heightPercent =
    image.heightPercent !== undefined ? lerp(moveFrom?.heightPercent, image.heightPercent) : undefined;

  return (
    <div
      style={{
        position: "absolute",
        left: `${lerp(moveFrom?.xPercent, image.xPercent)}%`,
        top: `${lerp(moveFrom?.yPercent, image.yPercent)}%`,
        width: `${lerp(moveFrom?.widthPercent, image.widthPercent)}%`,
        height: heightPercent !== undefined ? `${heightPercent}%` : undefined,
        // 位置は画像の中心で指定させているため、自分の大きさの半分だけ戻して中心を合わせる。
        transform: `translate(-50%, -50%) rotate(${image.rotationDeg}deg)`,
      }}
    >
      <div style={{ transform, opacity, filter, clipPath, height: image.heightPercent !== undefined ? "100%" : undefined }}>
        <Img
          src={resolveClipSrc(image.src)}
          style={
            image.heightPercent !== undefined
              ? // 高さも決まっている時(ランキングの枠など)は、枠いっぱいに切り抜いて収める
                { width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: image.cornerRadiusPx }
              : { width: "100%", height: "auto", display: "block", borderRadius: image.cornerRadiusPx }
          }
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
