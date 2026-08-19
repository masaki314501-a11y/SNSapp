import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RankingItemProps } from "./schema";
import { MediaBackground } from "../../shared/MediaBackground";
import { AnimatedCaption } from "../../shared/AnimatedCaption";

type Props = RankingItemProps & {
  index: number;
  rank: number;
  accentColor: string;
};

/**
 * ランキング項目1つ分。背景メディア + 順位バッジ(ポップイン) + タイトル + アニメーション付きテロップ。
 */
export const RankingItemSequence: React.FC<Props> = ({
  src,
  title,
  caption,
  startFromSeconds,
  index,
  rank,
  accentColor,
  captionAnimation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const badgeSpring = spring({
    frame,
    fps,
    config: { damping: 9, mass: 0.6 },
    durationInFrames: 15,
  });
  const badgeScale = interpolate(badgeSpring, [0, 1], [0.3, 1]);
  const badgeOpacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleOpacity = interpolate(frame, [6, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [6, 16], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <MediaBackground
        src={src}
        startFromSeconds={startFromSeconds}
        index={index}
        placeholderLabel={`第${rank}位(動画未設定)`}
      />

      <AbsoluteFill
        style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 96 }}
      >
        <div
          style={{
            transform: `scale(${badgeScale})`,
            opacity: badgeOpacity,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 132,
            height: 132,
            borderRadius: "50%",
            backgroundColor: accentColor,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: "white", fontSize: 56, fontWeight: 900, lineHeight: 1 }}>
            {rank}
          </span>
          <span style={{ color: "white", fontSize: 20, fontWeight: 700 }}>位</span>
        </div>
        <div
          style={{
            marginTop: 20,
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            color: "white",
            fontSize: 48,
            fontWeight: 800,
            textAlign: "center",
            textShadow: "0 4px 16px rgba(0,0,0,0.6)",
            padding: "0 48px",
          }}
        >
          {title}
        </div>
      </AbsoluteFill>

      <AnimatedCaption
        text={caption}
        accentColor={accentColor}
        animation={captionAnimation}
      />
    </AbsoluteFill>
  );
};
