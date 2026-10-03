import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  fitPixelsPerSecond,
  pinchPixelsPerSecond,
} from "./timelineScale";

describe("fitPixelsPerSecond", () => {
  it("動画全体が見える幅にちょうど収まる倍率を返す", () => {
    // スマホ幅390pxからトラック名の列などを除いた328pxに、79.6秒の動画を収める
    expect(fitPixelsPerSecond(328, 79.6)).toBeCloseTo(328 / 79.6);
  });

  it("幅や長さがまだ分からないときは既定の倍率にする", () => {
    expect(fitPixelsPerSecond(0, 80)).toBe(DEFAULT_PIXELS_PER_SECOND);
    expect(fitPixelsPerSecond(328, 0)).toBe(DEFAULT_PIXELS_PER_SECOND);
  });

  it("ごく短い動画は最大倍率で止める", () => {
    expect(fitPixelsPerSecond(1000, 1)).toBe(MAX_PIXELS_PER_SECOND);
  });

  it("1時間の動画でも最小倍率より小さくしない", () => {
    expect(fitPixelsPerSecond(300, 3600)).toBe(MIN_PIXELS_PER_SECOND);
  });
});

describe("pinchPixelsPerSecond", () => {
  it("指の間隔が2倍になれば倍率も2倍になる", () => {
    expect(pinchPixelsPerSecond(10, 100, 200)).toBe(20);
  });

  it("縮めれば倍率も下がる", () => {
    expect(pinchPixelsPerSecond(10, 200, 100)).toBe(5);
  });

  it("上限・下限を超えない", () => {
    expect(pinchPixelsPerSecond(200, 10, 1000)).toBe(MAX_PIXELS_PER_SECOND);
    expect(pinchPixelsPerSecond(2, 1000, 10)).toBe(MIN_PIXELS_PER_SECOND);
  });

  it("指の間隔が0のときは開始時の倍率のまま", () => {
    expect(pinchPixelsPerSecond(10, 0, 100)).toBe(10);
  });
});
