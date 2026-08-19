import React from "react";
import { AbsoluteFill } from "remotion";
import type { ClipProps } from "./schema";
import { MediaBackground } from "../../shared/MediaBackground";
import { AnimatedCaption } from "../../shared/AnimatedCaption";

type Props = ClipProps & {
  index: number;
  accentColor: string;
};

/**
 * 本題パート(3-20秒)の1カット分。動画/プレースホルダー背景 + アニメーション付きテロップ。
 */
export const ClipSequence: React.FC<Props> = ({
  src,
  caption,
  startFromSeconds,
  index,
  accentColor,
  captionAnimation,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <MediaBackground
        src={src}
        startFromSeconds={startFromSeconds}
        index={index}
        placeholderLabel={`CLIP ${index + 1}(動画未設定)`}
      />
      <AnimatedCaption
        text={caption}
        accentColor={accentColor}
        animation={captionAnimation}
      />
    </AbsoluteFill>
  );
};
