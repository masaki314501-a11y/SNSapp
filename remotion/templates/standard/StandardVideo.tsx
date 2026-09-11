import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  Series,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import type { StandardVideoProps } from "./schema";
import { resolveClipSrc } from "../../shared/resolveSrc";
import { resolveFontFamilyStack } from "../../shared/schema";
import { ClipSequence } from "./ClipSequence";
import { Hook } from "../../shared/Hook";
import { CTA } from "../../shared/CTA";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "../../shared/constants";
import { getStandardVideoDurationInFrames } from "./duration";

export const calculateStandardVideoMetadata: CalculateMetadataFunction<
  StandardVideoProps
> = ({ props }) => {
  return {
    durationInFrames: getStandardVideoDurationInFrames(props),
    props,
  };
};

// 全体フェードイン/アウトの長さ(フレーム数)。
const FADE_FRAMES = 15;

export const StandardVideo: React.FC<StandardVideoProps> = ({
  hook,
  clips,
  cta,
  theme,
  sfx,
  bgm,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeOpacity = theme.fadeInOut
    ? interpolate(
        frame,
        [0, FADE_FRAMES, Math.max(FADE_FRAMES, durationInFrames - FADE_FRAMES), durationInFrames],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : 1;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        fontFamily: resolveFontFamilyStack(theme.fontFamily),
        opacity: fadeOpacity,
      }}
    >
      <Series>
        {hook ? (
          <Series.Sequence
            durationInFrames={Math.round(HOOK_DURATION_IN_SECONDS * VIDEO_FPS)}
          >
            <Hook
              headline={hook.headline}
              subline={hook.subline}
              accentColor={theme.primaryColor}
            />
          </Series.Sequence>
        ) : null}

        {clips.map((clip, index) => (
          <Series.Sequence
            key={index}
            durationInFrames={Math.round(clip.durationInSeconds * VIDEO_FPS)}
          >
            <ClipSequence
              {...clip}
              index={index}
              accentColor={theme.primaryColor}
              captionStyle={theme.captionStyle}
              fontFamily={theme.fontFamily}
              captionPosition={theme.captionPosition}
              fontSize={theme.fontSize}
            />
          </Series.Sequence>
        ))}

        {cta ? (
          <Series.Sequence
            durationInFrames={Math.round(CTA_DURATION_IN_SECONDS * VIDEO_FPS)}
          >
            <CTA text={cta.text} accentColor={theme.primaryColor} />
          </Series.Sequence>
        ) : null}
      </Series>

      {bgm ? (
        <Audio
          src={resolveClipSrc(bgm.src)}
          volume={(bgmFrame) => {
            // フェード秒数分をフレーム数に変換し、動画尺の半分を超えないようクランプする
            // (短い動画でフェードイン/アウトの区間が重なって不自然にならないようにするため)。
            // フェード無し(0秒)の場合に区間の長さが0になりうるため、Remotionのinterpolate
            // (inputRangeの重複を許さない)ではなく単純な線形計算で求める。
            const fadeInFrames = Math.min(
              Math.round(bgm.fadeInSeconds * VIDEO_FPS),
              Math.floor(durationInFrames / 2)
            );
            const fadeOutFrames = Math.min(
              Math.round(bgm.fadeOutSeconds * VIDEO_FPS),
              Math.floor(durationInFrames / 2)
            );
            const fadeOutStartFrame = durationInFrames - fadeOutFrames;
            let fadeMultiplier = 1;
            if (fadeInFrames > 0 && bgmFrame < fadeInFrames) {
              fadeMultiplier = bgmFrame / fadeInFrames;
            } else if (fadeOutFrames > 0 && bgmFrame > fadeOutStartFrame) {
              fadeMultiplier = (durationInFrames - bgmFrame) / fadeOutFrames;
            }
            return bgm.volume * Math.min(Math.max(fadeMultiplier, 0), 1);
          }}
          loop
        />
      ) : null}

      {sfx?.map((clip, index) => (
        <Sequence key={index} from={Math.round(clip.startFromSeconds * VIDEO_FPS)} layout="none">
          <Audio src={resolveClipSrc(clip.src)} volume={clip.volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
