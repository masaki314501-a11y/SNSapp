import { describe, expect, it } from "vitest";
import {
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  clampPixelsPerSecond,
  formatTimecode,
  pickRulerStepSeconds,
  pixelsToSeconds,
  secondsToPixels,
} from "./timelineScale";

describe("clampPixelsPerSecond", () => {
  it("範囲内はそのまま返す", () => {
    expect(clampPixelsPerSecond(100)).toBe(100);
  });

  it("下限未満は下限にクランプする", () => {
    expect(clampPixelsPerSecond(1)).toBe(MIN_PIXELS_PER_SECOND);
  });

  it("上限超過は上限にクランプする", () => {
    expect(clampPixelsPerSecond(9999)).toBe(MAX_PIXELS_PER_SECOND);
  });
});

describe("secondsToPixels / pixelsToSeconds", () => {
  it("相互に往復変換できる", () => {
    const seconds = 12.5;
    const pixelsPerSecond = 56;
    const pixels = secondsToPixels(seconds, pixelsPerSecond);
    expect(pixels).toBe(700);
    expect(pixelsToSeconds(pixels, pixelsPerSecond)).toBeCloseTo(seconds);
  });
});

describe("pickRulerStepSeconds", () => {
  it("ズームが大きい(拡大)ほど細かい目盛りを選ぶ", () => {
    expect(pickRulerStepSeconds(200)).toBe(0.5);
  });

  it("ズームが小さい(縮小)ほど粗い目盛りを選ぶ", () => {
    expect(pickRulerStepSeconds(20)).toBe(5);
  });

  it("どの目盛りも間隔を満たせない場合は最大の目盛りにフォールバックする", () => {
    expect(pickRulerStepSeconds(0.01)).toBe(300);
  });
});

describe("formatTimecode", () => {
  it("mm:ss.f 形式で表示する", () => {
    expect(formatTimecode(65.34)).toBe("1:05.3");
  });

  it("0秒は 0:00.0", () => {
    expect(formatTimecode(0)).toBe("0:00.0");
  });

  it("負の値は0にクランプする", () => {
    expect(formatTimecode(-5)).toBe("0:00.0");
  });
});
