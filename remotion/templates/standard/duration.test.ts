import { describe, expect, it } from "vitest";
import { getStandardVideoDurationInFrames } from "./duration";
import type { ClipProps } from "./schema";

const clip = (durationInSeconds: number): ClipProps => ({
  caption: "",
  durationInSeconds,
  startFromSeconds: 0,
  captionAnimation: "slide-up",
  volume: 1,
});

describe("getStandardVideoDurationInFrames", () => {
  it("hook/ctaが無ければクリップ尺の合計のみ(30fps換算)", () => {
    const frames = getStandardVideoDurationInFrames({
      clips: [clip(1), clip(2.5)],
    });
    expect(frames).toBe(30 + 75);
  });

  it("hook(3秒)・cta(5秒)がある場合はそれぞれ加算する", () => {
    const frames = getStandardVideoDurationInFrames({
      clips: [clip(2)],
      hook: { headline: "見出し" },
      cta: { text: "詳しくはプロフィールへ" },
    });
    // クリップ: round(2*30)=60, hook: round(3*30)=90, cta: round(5*30)=150
    expect(frames).toBe(60 + 90 + 150);
  });

  it("端数フレームはクリップ毎に丸める", () => {
    const frames = getStandardVideoDurationInFrames({
      clips: [clip(0.33), clip(0.34)],
    });
    // round(0.33*30)=round(9.9)=10, round(0.34*30)=round(10.2)=10
    expect(frames).toBe(20);
  });
});
