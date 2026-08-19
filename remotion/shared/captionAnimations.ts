import { interpolate, spring } from "remotion";
import type { CaptionAnimation } from "./schema";

type AnimationStyle = {
  transform: string;
  opacity: number;
};

/**
 * カット内でのローカルフレーム(そのSequence先頭からの経過フレーム)を基準に、
 * テロップの出現アニメーションのtransform/opacityを算出する。
 */
export const getCaptionAnimationStyle = (
  pattern: CaptionAnimation,
  localFrame: number,
  fps: number
): AnimationStyle => {
  const opacity = interpolate(localFrame, [3, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const springFrame = localFrame - 3;

  switch (pattern) {
    case "fade": {
      return { transform: "none", opacity };
    }
    case "pop": {
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 10, mass: 0.5 },
        durationInFrames: 15,
      });
      const scale = interpolate(progress, [0, 1], [0.5, 1]);
      return { transform: `scale(${scale})`, opacity };
    }
    case "zoom-in": {
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 16 },
        durationInFrames: 15,
      });
      const scale = interpolate(progress, [0, 1], [1.5, 1]);
      return { transform: `scale(${scale})`, opacity };
    }
    case "slide-up":
    default: {
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 14 },
        durationInFrames: 12,
      });
      const y = interpolate(progress, [0, 1], [40, 0]);
      return { transform: `translateY(${y}px)`, opacity };
    }
  }
};
