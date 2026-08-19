"use client";

import { Player } from "@remotion/player";
import { ShortVideo } from "@video/compositions/ShortVideo/ShortVideo";
import { defaultShortVideoProps } from "@video/compositions/ShortVideo/defaultProps";
import { getShortVideoDurationInFrames } from "@video/compositions/ShortVideo/duration";
import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "@video/compositions/ShortVideo/constants";

export default function PreviewPage() {
  const durationInFrames = getShortVideoDurationInFrames(defaultShortVideoProps);

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
      <Player
        component={ShortVideo}
        inputProps={defaultShortVideoProps}
        durationInFrames={durationInFrames}
        fps={VIDEO_FPS}
        compositionWidth={VIDEO_WIDTH}
        compositionHeight={VIDEO_HEIGHT}
        style={{ width: 360, height: 640 }}
        controls
        loop
      />
    </main>
  );
}
