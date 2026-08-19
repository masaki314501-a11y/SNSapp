"use client";

import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "@video/shared/constants";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { defaultStandardVideoProps } from "@video/templates/standard/defaultProps";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import { RankingVideo } from "@video/templates/ranking/RankingVideo";
import { defaultRankingVideoProps } from "@video/templates/ranking/defaultProps";
import { getRankingVideoDurationInFrames } from "@video/templates/ranking/duration";
import { templateRegistry, TEMPLATE_IDS, type TemplateId } from "@video/templates/registry";

export default function PreviewPage() {
  const [templateId, setTemplateId] = useState<TemplateId>("standard");

  const durationInFrames = useMemo(
    () =>
      templateId === "standard"
        ? getStandardVideoDurationInFrames(defaultStandardVideoProps)
        : getRankingVideoDurationInFrames(defaultRankingVideoProps),
    [templateId]
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 32,
        background: "#111114",
      }}
    >
      <div style={{ color: "white", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>ショート動画プレビュー</h1>
        <p style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
          {(durationInFrames / VIDEO_FPS).toFixed(1)}秒 / {VIDEO_WIDTH}x{VIDEO_HEIGHT}
        </p>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {TEMPLATE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTemplateId(id)}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              fontSize: 13,
              border: "1px solid rgba(255,255,255,0.2)",
              background: id === templateId ? "white" : "transparent",
              color: id === templateId ? "black" : "white",
              cursor: "pointer",
            }}
          >
            {templateRegistry[id].label}
          </button>
        ))}
      </div>

      {templateId === "standard" ? (
        <Player
          component={StandardVideo}
          inputProps={defaultStandardVideoProps}
          durationInFrames={durationInFrames}
          fps={VIDEO_FPS}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          style={{ width: 360, height: 640 }}
          controls
          loop
        />
      ) : (
        <Player
          component={RankingVideo}
          inputProps={defaultRankingVideoProps}
          durationInFrames={durationInFrames}
          fps={VIDEO_FPS}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          style={{ width: 360, height: 640 }}
          controls
          loop
        />
      )}
    </main>
  );
}
