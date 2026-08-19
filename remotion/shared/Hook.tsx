import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {
  headline: string;
  subline?: string;
  accentColor: string;
};

/**
 * フックパート(0-3秒): 結論・数字を先出しして離脱を防ぐ導入テロップ。
 */
export const Hook: React.FC<Props> = ({ headline, subline, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 12, mass: 0.6 },
    durationInFrames: 15,
  });
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  const flashOpacity = interpolate(frame, [0, 6, 16], [0.55, 0, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0B0F",
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
      }}
    >
      <AbsoluteFill style={{ backgroundColor: accentColor, opacity: flashOpacity }} />
      <div style={{ transform: `scale(${scale})`, opacity, textAlign: "center" }}>
        <div
          style={{
            color: "white",
            fontSize: 84,
            fontWeight: 900,
            lineHeight: 1.25,
            whiteSpace: "pre-wrap",
            textShadow: "0 6px 24px rgba(0,0,0,0.55)",
          }}
        >
          {headline}
        </div>
        {subline ? (
          <div
            style={{
              marginTop: 28,
              fontSize: 40,
              fontWeight: 700,
              color: accentColor,
            }}
          >
            {subline}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
