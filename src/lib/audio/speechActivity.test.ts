import { describe, expect, it } from "vitest";
import { FRAME_SECONDS, detectSpeechSpans, snapToQuiet } from "./speechActivity";

/** 10msごとの音の大きさを、[秒, dB]の区切りから作る。 */
const levelsOf = (seconds: number, loud: [number, number][]): Float32Array => {
  const levels = new Float32Array(Math.round(seconds / FRAME_SECONDS)).fill(-60);
  for (const [a, b] of loud) {
    for (let f = Math.round(a / FRAME_SECONDS); f < Math.round(b / FRAME_SECONDS); f++) levels[f] = -20;
  }
  return levels;
};

describe("speechActivity", () => {
  it("短い息継ぎはつなげ、短い物音は捨てて、話している区間を出す", () => {
    const levels = levelsOf(4, [
      [0.5, 1.2],
      [1.3, 2.0],
      [3.0, 3.05],
    ]);
    expect(detectSpeechSpans(levels, -60)).toEqual([[0.5, 2]]);
  });

  it("カットの位置を近くの静かな所へ寄せ、近くに静かな所が無ければそのまま", () => {
    const levels = levelsOf(4, [
      [0.5, 1.5],
      [1.7, 3.5],
    ]);
    const activity = { levels, noiseFloorDb: -60, spans: [] };
    // 1.45秒(言葉の途中)のカットは、1.5秒からの間へ寄る
    const snapped = snapToQuiet(activity, 1.45);
    expect(snapped).toBeGreaterThanOrEqual(1.5);
    expect(snapped).toBeLessThan(1.7);
    // 2.5秒の前後0.35秒はずっと話しているので寄せない
    expect(snapToQuiet(activity, 2.5)).toBe(2.5);
  });
});
