import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { getCaptionAnimationStyle } from "./captionAnimations";
import type { CaptionAnimation, CaptionStyle } from "./schema";

type Props = {
  text: string;
  accentColor: string;
  animation: CaptionAnimation;
  /** pill=アクセントカラーの角丸背景、outline=背景無しの白文字+黒縁取り */
  captionStyle?: CaptionStyle;
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
  captionStyle = "pill",
  bottomOffset = 160,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { transform, opacity, clipPath } = getCaptionAnimationStyle(animation, frame, fps);

  const textStyle: React.CSSProperties =
    captionStyle === "outline"
      ? {
          display: "inline-block",
          color: "white",
          WebkitTextStroke: `2.5px ${accentColor}`,
          paintOrder: "stroke fill",
          fontSize: 48,
          fontWeight: 900,
          lineHeight: 1.35,
          textShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }
      : {
          display: "inline-block",
          backgroundColor: accentColor,
          color: "white",
          fontSize: 44,
          fontWeight: 800,
          padding: "16px 32px",
          borderRadius: 16,
          lineHeight: 1.35,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        };

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
        <span style={{ ...textStyle, clipPath }}>{text}</span>
      </div>
    </AbsoluteFill>
  );
};
