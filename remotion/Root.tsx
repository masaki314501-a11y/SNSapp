import React from "react";
import { Composition } from "remotion";
import { ShortVideo, calculateShortVideoMetadata } from "./compositions/ShortVideo/ShortVideo";
import { shortVideoSchema } from "./compositions/ShortVideo/schema";
import { defaultShortVideoProps } from "./compositions/ShortVideo/defaultProps";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./compositions/ShortVideo/constants";
import { getShortVideoDurationInFrames } from "./compositions/ShortVideo/duration";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ShortVideo"
        component={ShortVideo}
        durationInFrames={getShortVideoDurationInFrames(defaultShortVideoProps)}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        schema={shortVideoSchema}
        defaultProps={defaultShortVideoProps}
        calculateMetadata={calculateShortVideoMetadata}
      />
    </>
  );
};
