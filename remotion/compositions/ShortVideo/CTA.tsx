import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

type Props = {
  text: string;
  accentColor: string;
};

/**
 * CTAパート(20-25秒): 一言の行動喚起 + ゆるいパルスアニメーション。
 */
export const CTA: React.FC<Props> = ({ text, accentColor }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const pulse = 1 + Math.sin(frame / 8) * 0.04;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B0B0F",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ opacity, textAlign: "center", transform: `scale(${pulse})` }}>
        <div
          style={{
            display: "inline-block",
            border: `4px solid ${accentColor}`,
            borderRadius: 999,
            padding: "20px 48px",
            color: "white",
            fontSize: 48,
            fontWeight: 800,
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>
        <div style={{ marginTop: 28, fontSize: 64, color: accentColor }}>↑</div>
      </div>
    </AbsoluteFill>
  );
};
