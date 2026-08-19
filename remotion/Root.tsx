import React from "react";
import { Composition } from "remotion";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./shared/constants";
import { clientTemplateRegistry } from "./templates/clientRegistry";

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
        id={clientTemplateRegistry.ranking.compositionId}
        component={clientTemplateRegistry.ranking.component}
        durationInFrames={clientTemplateRegistry.ranking.getDurationInFrames(
          clientTemplateRegistry.ranking.defaultProps
        )}
        fps={VIDEO_FPS}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        schema={clientTemplateRegistry.ranking.schema}
        defaultProps={clientTemplateRegistry.ranking.defaultProps}
        calculateMetadata={clientTemplateRegistry.ranking.calculateMetadata}
      />
    </>
  );
};
