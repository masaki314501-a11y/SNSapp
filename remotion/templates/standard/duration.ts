import type { StandardVideoProps } from "./schema";
import { VIDEO_FPS } from "../../shared/constants";

/**
 * 各クリップ尺の合計からフレーム数を算出する。フック・CTAはカットの上に重ねるだけで
 * 尺を足さない(StandardVideo.tsx参照)。効果音やナレーションの開始秒がクリップの累積秒と
 * ずれないようにするためでもある。
 * Composition の calculateMetadata と Player の両方から参照する単一の計算ロジック。
 */
export const getStandardVideoDurationInFrames = (props: Pick<StandardVideoProps, "clips">): number =>
  Math.max(
    1,
    props.clips.reduce((sum, clip) => sum + Math.round(clip.durationInSeconds * VIDEO_FPS), 0)
  );
