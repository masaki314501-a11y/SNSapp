import React from "react";
import { AbsoluteFill } from "remotion";
import type { ClipProps } from "./schema";
import type { CaptionFontFamily, CaptionFontSize, CaptionPosition, CaptionStyle, VideoFraming } from "../../shared/schema";
import { resolveFontFamilyStack } from "../../shared/schema";
import { TextOverlays } from "../../shared/TextOverlays";
import { ImageOverlays } from "../../shared/ImageOverlays";
import { MediaBackground } from "../../shared/MediaBackground";
import { AnimatedCaption } from "../../shared/AnimatedCaption";

type Props = ClipProps & {
  index: number;
  accentColor: string;
  captionStyle: CaptionStyle;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  fontSize: CaptionFontSize;
  /** 動画全体の画角(全クリップ共通)。 */
  framing?: VideoFraming;
  /**
   * 描く層。base=映像・テロップ・画像、text=強調テキストだけ。強調テキストを動画全体の画像・図形
   * (ランキングの枠など)より上に重ねるため、StandardVideoで層を分けて2回描く。
   */
  layer: "base" | "text";
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
  captionStyle,
  fontFamily,
  captionPosition,
  fontSize,
  volume,
  emphasisWords,
  emphasisColor,
  zoom,
  overlays,
  images,
  framing,
  layer,
}) => {
  if (layer === "text") {
    return overlays && overlays.length > 0 ? (
      <TextOverlays overlays={overlays} fontFamilyStack={resolveFontFamilyStack(fontFamily)} />
    ) : null;
  }
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <MediaBackground
        src={src}
        startFromSeconds={startFromSeconds}
        index={index}
        placeholderLabel={`CLIP ${index + 1}(動画未設定)`}
        volume={volume}
        zoom={zoom}
        framing={framing}
      />
      <AnimatedCaption
        text={caption}
        accentColor={accentColor}
        animation={captionAnimation}
        captionStyle={captionStyle}
        fontFamily={fontFamily}
        position={captionPosition}
        fontSize={fontSize}
        emphasisWords={emphasisWords}
        emphasisColor={emphasisColor}
      />
      {/* 強調テキストはlayer="text"で、動画全体の画像・図形より上に別に描く。 */}
      {images && images.length > 0 ? <ImageOverlays images={images} /> : null}
    </AbsoluteFill>
  );
};
