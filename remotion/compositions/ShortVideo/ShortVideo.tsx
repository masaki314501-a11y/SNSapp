import React from "react";
import { AbsoluteFill, Series, type CalculateMetadataFunction } from "remotion";
import type { ShortVideoProps } from "./schema";
import { Hook } from "./Hook";
import { ClipSequence } from "./ClipSequence";
import { CTA } from "./CTA";
import { CTA_DURATION_IN_SECONDS, HOOK_DURATION_IN_SECONDS, VIDEO_FPS } from "./constants";
import { getShortVideoDurationInFrames } from "./duration";
import "./font";

export const calculateShortVideoMetadata: CalculateMetadataFunction<
  ShortVideoProps
> = ({ props }) => {
  return {
    durationInFrames: getShortVideoDurationInFrames(props),
    props,
  };
};

export const ShortVideo: React.FC<ShortVideoProps> = ({
  hook,
  clips,
  cta,
  theme,
}) => {
  return (
    <AbsoluteFill
      style={{ backgroundColor: "#000", fontFamily: theme.fontFamily }}
    >
      <Series>
        <Series.Sequence
          durationInFrames={Math.round(HOOK_DURATION_IN_SECONDS * VIDEO_FPS)}
        >
          <Hook
            headline={hook.headline}
            subline={hook.subline}
            accentColor={theme.primaryColor}
          />
        </Series.Sequence>

        {clips.map((clip, index) => (
          <Series.Sequence
            key={index}
            durationInFrames={Math.round(clip.durationInSeconds * VIDEO_FPS)}
          >
            <ClipSequence {...clip} index={index} accentColor={theme.primaryColor} />
          </Series.Sequence>
        ))}

        <Series.Sequence
          durationInFrames={Math.round(CTA_DURATION_IN_SECONDS * VIDEO_FPS)}
        >
          <CTA text={cta.text} accentColor={theme.primaryColor} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
