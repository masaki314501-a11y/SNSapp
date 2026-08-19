import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { CaptionAnimation } from "./schema";

type Props = {
  text: string;
  accentColor: string;
  animation: CaptionAnimation;
  bottomOffset?: number;
};

/**
 * カット/ランキングアイテム共通のテロップ表示。パターンに応じた出現アニメーションは
 * captionAnimations.ts に委譲する。
 */
export const AnimatedCaption: React.FC<Props> = ({
  text,
  accentColor,
  animation,
  bottomOffset = 160,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity } = getCaptionAnimationStyle(animation, frame, fps);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: bottomOffset,
        paddingLeft: 48,
        paddingRight: 48,
      }}
    >
      <div style={{ transform, opacity, maxWidth: "100%", textAlign: "center" }}>
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
          {text}
        </span>
      </div>
    </AbsoluteFill>
  );
};
