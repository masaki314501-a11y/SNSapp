import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

type Props = {
  text: string;
  accentColor: string;
};

/**
 * CTA(動画の最後の数秒): 一言の行動喚起 + ゆるいパルスアニメーション。
 * フックと同じ理由で、黒背景のカードを足すのではなく最後のカットの上に重ねる。
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
        // 中央は字幕(captionPosition=middle)とぶつかりやすいため、画面下寄りに出す。
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 380,
        paddingLeft: 60,
        paddingRight: 60,
      }}
    >
      <div style={{ opacity, textAlign: "center", transform: `scale(${pulse})` }}>
        <div
          style={{
            display: "inline-block",
            border: `4px solid ${accentColor}`,
            backgroundColor: "rgba(0,0,0,0.55)",
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
