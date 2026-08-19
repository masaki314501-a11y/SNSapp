import React from "react";
import { AbsoluteFill, Series, type CalculateMetadataFunction } from "remotion";
import type { StandardVideoProps } from "./schema";
import { ClipSequence } from "./ClipSequence";
import { Hook } from "../../shared/Hook";
import { CTA } from "../../shared/CTA";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "../../shared/constants";
import { getStandardVideoDurationInFrames } from "./duration";
import "../../shared/font";

export const calculateStandardVideoMetadata: CalculateMetadataFunction<
  StandardVideoProps
> = ({ props }) => {
  return {
    durationInFrames: getStandardVideoDurationInFrames(props),
    props,
  };
};

export const StandardVideo: React.FC<StandardVideoProps> = ({
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
