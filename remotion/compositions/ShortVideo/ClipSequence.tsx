import React from "react";
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ClipProps } from "./schema";
import { resolveClipSrc } from "./resolveSrc";

const PLACEHOLDER_COLORS = ["#1F2937", "#312E81", "#7C2D12", "#134E4A"];

type Props = ClipProps & {
  index: number;
  accentColor: string;
};

/**
 * 本題パート(3-20秒)の1カット分。動画 + テロップ + カット頭のパンチイン/テロップのスプリングイン。
 * src 未指定時はプレースホルダー背景を表示し、実素材が無くてもプレビュー・レンダーが成立するようにする。
 */
export const ClipSequence: React.FC<Props> = ({
  src,
  caption,
  startFromSeconds,
  index,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const zoom = interpolate(frame, [0, 10], [1.06, 1], {
    extrapolateRight: "clamp",
  });

  const captionSpring = spring({
    frame: frame - 3,
    fps,
    config: { damping: 14 },
    durationInFrames: 12,
  });
  const captionY = interpolate(captionSpring, [0, 1], [40, 0]);
  const captionOpacity = interpolate(frame, [3, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        {src ? (
          <OffthreadVideo
            src={resolveClipSrc(src)}
            startFrom={Math.round(startFromSeconds * fps)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <AbsoluteFill
            style={{
              backgroundColor: PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length],
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <span
              style={{
                color: "rgba(255,255,255,0.3)",
                fontSize: 32,
                fontWeight: 700,
              }}
            >
              CLIP {index + 1}(動画未設定)
            </span>
          </AbsoluteFill>
        )}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "flex-end",
          alignItems: "center",
          paddingBottom: 160,
          paddingLeft: 48,
          paddingRight: 48,
        }}
      >
        <div
          style={{
            transform: `translateY(${captionY}px)`,
            opacity: captionOpacity,
            maxWidth: "100%",
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "inline-block",
              backgroundColor: accentColor,
              color: "white",
              fontSize: 44,
              fontWeight: 800,
              padding: "16px 32px",
              borderRadius: 16,
              lineHeight: 1.35,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {caption}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
