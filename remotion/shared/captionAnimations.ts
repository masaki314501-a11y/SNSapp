import { interpolate, spring } from "remotion";
import type { CaptionAnimation } from "./schema";

type AnimationStyle = {
  transform: string;
  opacity: number;
  /** "highlight-sweep"専用: マーカーで左から塗るような背景の見え方(clip-path)。 */
  clipPath?: string;
  /** "blur-in"専用: ぼかしから鮮明になるフィルター。 */
  filter?: string;
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
    case "highlight-sweep": {
      // マーカーで左から塗っていくように背景だけを先に見せ、テキストは即表示する。
      const sweep = interpolate(localFrame, [2, 16], [0, 100], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      return {
        transform: "none",
        opacity: interpolate(localFrame, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        clipPath: `inset(0 ${100 - sweep}% 0 0)`,
      };
    }
    case "shake-in": {
      // 登場直後に強めに揺れてから止まる、注意を引くための演出。
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 6, mass: 0.4 },
        durationInFrames: 18,
      });
      const wiggle = Math.sin(progress * Math.PI * 3) * (1 - progress) * 8;
      const scale = interpolate(progress, [0, 1], [0.7, 1]);
      return { transform: `scale(${scale}) rotate(${wiggle}deg)`, opacity };
    }
    case "blur-in": {
      // ピント合わせのように、ぼかしを残しながらフェードインする。
      const progress = interpolate(localFrame, [0, 16], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      return { transform: "none", opacity, filter: `blur(${(1 - progress) * 10}px)` };
    }
    case "slide-side": {
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 14 },
        durationInFrames: 14,
      });
      const x = interpolate(progress, [0, 1], [-60, 0]);
      return { transform: `translateX(${x}px)`, opacity };
    }
    case "flip-in": {
      // 縦回転しながらめくれて正面を向く。
      const progress = spring({
        frame: springFrame,
        fps,
        config: { damping: 12 },
        durationInFrames: 16,
      });
      const rotate = interpolate(progress, [0, 1], [90, 0]);
      return { transform: `perspective(600px) rotateX(${rotate}deg)`, opacity };
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
