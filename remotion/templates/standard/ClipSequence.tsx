import React from "react";
import { AbsoluteFill } from "remotion";
import type { ClipProps } from "./schema";
import type { CaptionFontFamily, CaptionFontSize, CaptionPosition, CaptionStyle } from "../../shared/schema";
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
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <MediaBackground
        src={src}
        startFromSeconds={startFromSeconds}
        index={index}
        placeholderLabel={`CLIP ${index + 1}(動画未設定)`}
        volume={volume}
        zoom={zoom}
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
      {/* 画像は強調テキストより下に重ねる(文字が画像に隠れないように)。 */}
      {images && images.length > 0 ? <ImageOverlays images={images} /> : null}
      {overlays && overlays.length > 0 ? (
        <TextOverlays overlays={overlays} fontFamilyStack={resolveFontFamilyStack(fontFamily)} />
      ) : null}
    </AbsoluteFill>
  );
};
