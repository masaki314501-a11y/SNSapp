import type { StandardVideoProps } from "./schema";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "../../shared/constants";

/**
 * フック(任意・3秒) + 各クリップ尺の合計 + CTA(任意・5秒) からフレーム数を算出する。
 * Composition の calculateMetadata と Player の両方から参照する単一の計算ロジック。
 */
export const getStandardVideoDurationInFrames = (
  props: Pick<StandardVideoProps, "clips" | "hook" | "cta">
): number => {
  const clipsDurationInFrames = props.clips.reduce(
    (sum, clip) => sum + Math.round(clip.durationInSeconds * VIDEO_FPS),
    0
  );

  return (
    (props.hook ? Math.round(HOOK_DURATION_IN_SECONDS * VIDEO_FPS) : 0) +
    clipsDurationInFrames +
    (props.cta ? Math.round(CTA_DURATION_IN_SECONDS * VIDEO_FPS) : 0)
  );
};
