import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { TextOverlay } from "./schema";

type Props = {
  overlays: TextOverlay[];
  fontFamilyStack: string;
};

const OverlayText: React.FC<{ overlay: TextOverlay; fontFamilyStack: string }> = ({ overlay, fontFamilyStack }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath, filter } = getCaptionAnimationStyle(overlay.animation, frame, fps);

  return (
    <div
      style={{
        position: "absolute",
        left: `${overlay.xPercent}%`,
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
          style={{
            display: "inline-block",
            clipPath,
            color: overlay.color,
            backgroundColor: overlay.backgroundColor,
            padding: overlay.backgroundColor ? "0.12em 0.4em" : undefined,
            borderRadius: overlay.backgroundColor ? "0.2em" : undefined,
            WebkitTextStroke: overlay.strokeColor ? `${Math.max(2, overlay.fontSizePx / 18)}px ${overlay.strokeColor}` : undefined,
            paintOrder: "stroke fill",
            fontFamily: fontFamilyStack,
            fontSize: overlay.fontSizePx,
            fontWeight: 900,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
            textShadow: overlay.backgroundColor ? undefined : "0 6px 18px rgba(0,0,0,0.55)",
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
