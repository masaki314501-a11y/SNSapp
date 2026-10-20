import React from "react";
import { Composition } from "remotion";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./shared/constants";
import { clientTemplateRegistry } from "./templates/clientRegistry";
import { COVER_DURATION_IN_FRAMES, COVER_FPS, Cover, type CoverProps } from "./templates/cover/Cover";

/** 表紙(サムネイル)の見本の値。Remotion Studioで見た目を確かめる時に使う。 */
const coverDefaultProps: CoverProps = {
  videoSrc: "",
  frameSeconds: 1,
  title: "矯正した方がいい\n歯並びTOP5",
  yPercent: 22,
  fontSizePx: 120,
  fontFamily: "Noto Sans JP",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id={clientTemplateRegistry.standard.compositionId}
      component={clientTemplateRegistry.standard.component}
      durationInFrames={clientTemplateRegistry.standard.getDurationInFrames(
        clientTemplateRegistry.standard.defaultProps
      )}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      schema={clientTemplateRegistry.standard.schema}
      defaultProps={clientTemplateRegistry.standard.defaultProps}
      calculateMetadata={clientTemplateRegistry.standard.calculateMetadata}
    />
    <Composition
      id="Cover"
      component={Cover}
      durationInFrames={COVER_DURATION_IN_FRAMES}
      fps={COVER_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={coverDefaultProps}
    />
    </>
  );
};
