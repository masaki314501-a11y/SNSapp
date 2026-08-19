import type { RankingVideoProps } from "./schema";
import {
  CTA_DURATION_IN_SECONDS,
  HOOK_DURATION_IN_SECONDS,
  VIDEO_FPS,
} from "../../shared/constants";

/**
 * フック(固定3秒) + 各ランキング項目尺の合計 + CTA(固定5秒) からフレーム数を算出する。
 */
export const getRankingVideoDurationInFrames = (
  props: Pick<RankingVideoProps, "items">
): number => {
  const itemsDurationInFrames = props.items.reduce(
    (sum, item) => sum + Math.round(item.durationInSeconds * VIDEO_FPS),
    0
  );

  return (
    Math.round(HOOK_DURATION_IN_SECONDS * VIDEO_FPS) +
    itemsDurationInFrames +
    Math.round(CTA_DURATION_IN_SECONDS * VIDEO_FPS)
  );
};
