import React from "react";
import { AbsoluteFill } from "remotion";
import type { ClipProps } from "./schema";
import type { CaptionFontFamily, CaptionFontSize, CaptionPosition, CaptionStyle, VideoFraming } from "../../shared/schema";
import { resolveFontFamilyStack } from "../../shared/schema";
import { TextOverlays } from "../../shared/TextOverlays";
import { ImageOverlays } from "../../shared/ImageOverlays";
import { MediaBackground } from "../../shared/MediaBackground";
import { AnimatedCaption } from "../../shared/AnimatedCaption";
import type { WordSyncMode } from "../../shared/wordSync";

type Props = ClipProps & {
  index: number;
  accentColor: string;
  captionStyle: CaptionStyle;
  fontFamily: CaptionFontFamily;
  captionPosition: CaptionPosition;
  fontSize: CaptionFontSize;
  /** 動画全体の画角(全クリップ共通)。 */
  framing?: VideoFraming;
  /** 字幕の文字スタイル(このクリップで使う物)と重大ワード(全クリップ共通)。 */
  captionTextStyleId?: string;
  /** 文字スタイルの書体より、選んだフォントを使うか。 */
  captionFontPinned?: boolean;
  keywordHighlights?: { word: string; color: string }[];
  /** 字幕を話に合わせて見せるか、元の動画で話している区間(元の動画の秒数)、光らせる色。 */
  wordSync?: WordSyncMode;
  speechSpans?: [number, number][];
  wordHighlightColor?: string;
  /**
   * 描く層。base=映像・テロップ・画像、text=強調テキストだけ。強調テキストを動画全体の画像・図形
   * (ランキングの枠など)より上に重ねるため、StandardVideoで層を分けて2回描く。
   */
  layer: "base" | "text";
};

/** 元の動画で話している区間のうち、このクリップに入る分を、クリップの先頭からの秒数にして返す。 */
const clipSpeechSpans = (
  spans: [number, number][] | undefined,
  startFromSeconds: number,
  durationInSeconds: number
): [number, number][] =>
  (spans ?? [])
    .filter(([a, b]) => b > startFromSeconds && a < startFromSeconds + durationInSeconds)
    .map(([a, b]) => [Math.max(0, a - startFromSeconds), Math.min(durationInSeconds, b - startFromSeconds)]);

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
  captionAccentColor,
  captionFontFamily,
  captionGlowColor,
  zoom,
  overlays,
  images,
  clipCaptionPosition,
  captionEmphasis,
  captionTextStyleId,
  captionFontPinned,
  keywordHighlights,
  wordSync,
  speechSpans,
  wordHighlightColor,
  durationInSeconds,
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
        accentColor={captionAccentColor ?? accentColor}
        glowColor={captionGlowColor}
        animation={captionAnimation}
        captionStyle={captionStyle}
        fontFamily={captionFontFamily ?? fontFamily}
        position={clipCaptionPosition ?? captionPosition}
        fontSize={fontSize}
        emphasisWords={emphasisWords}
        emphasisColor={emphasisColor}
        textStyleId={captionTextStyleId}
        fontPinned={captionFontPinned}
        keywordHighlights={keywordHighlights}
        emphasis={captionEmphasis}
        wordSync={wordSync}
        speechSpans={clipSpeechSpans(speechSpans, startFromSeconds, durationInSeconds)}
        wordHighlightColor={wordHighlightColor}
      />
      {/* 強調テキストはlayer="text"で、動画全体の画像・図形より上に別に描く。 */}
      {images && images.length > 0 ? <ImageOverlays images={images} /> : null}
    </AbsoluteFill>
  );
};
