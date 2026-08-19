import type { ShortVideoProps } from "./schema";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "./constants";

/**
 * フック(固定3秒) + 各クリップ尺の合計 + CTA(固定5秒) からフレーム数を算出する。
 * Composition の calculateMetadata と Player の両方から参照する単一の計算ロジック。
 */
export const getShortVideoDurationInFrames = (
  props: Pick<ShortVideoProps, "clips">
): number => {
  const clipsDurationInFrames = props.clips.reduce(
    (sum, clip) => sum + Math.round(clip.durationInSeconds * VIDEO_FPS),
    0
  );

  return (
    Math.round(HOOK_DURATION_IN_SECONDS * VIDEO_FPS) +
    clipsDurationInFrames +
    Math.round(CTA_DURATION_IN_SECONDS * VIDEO_FPS)
  );
};
