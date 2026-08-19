import React from "react";
import { AbsoluteFill, Series, type CalculateMetadataFunction } from "remotion";
import type { RankingVideoProps } from "./schema";
import { RankingItemSequence } from "./RankingItemSequence";
import { Hook } from "../../shared/Hook";
import { CTA } from "../../shared/CTA";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "../../shared/constants";
import { getRankingVideoDurationInFrames } from "./duration";
import "../../shared/font";

export const calculateRankingVideoMetadata: CalculateMetadataFunction<
  RankingVideoProps
> = ({ props }) => {
  return {
    durationInFrames: getRankingVideoDurationInFrames(props),
    props,
  };
};

export const RankingVideo: React.FC<RankingVideoProps> = ({
  hook,
  items,
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

        {items.map((item, index) => (
          <Series.Sequence
            key={index}
            durationInFrames={Math.round(item.durationInSeconds * VIDEO_FPS)}
          >
            <RankingItemSequence
              {...item}
              index={index}
              rank={items.length - index}
              accentColor={theme.primaryColor}
            />
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
