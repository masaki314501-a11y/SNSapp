import { describe, expect, it } from "vitest";
import { applyCameraRule, cameraRuleForTemplate } from "./cameraRules";

const face = { xPercent: 40, yPercent: 30, widthPercent: 30, heightPercent: 16 };
const clips = Array.from({ length: 8 }, (_, index) => ({
  durationInSeconds: 2,
  faceBox: face,
  cameraHighlight: index === 5,
}));

describe("applyCameraRule", () => {
  it("ランキングは山場だけ顔を中心に少し寄り、ほかは動かさない", () => {
    const zooms = applyCameraRule("ranking", clips);
    expect(zooms.filter(Boolean)).toHaveLength(1);
    expect(zooms[5]).toEqual({ scale: 1.15, style: "punch", focusXPercent: 40, focusYPercent: 30 });
  });

  it("2択は山場のほか、間隔を空けてゆっくり寄る・横に流す動きを交互に入れ、続けては動かさない", () => {
    const zooms = applyCameraRule("two-choice", Array.from({ length: 12 }, () => ({ durationInSeconds: 2, faceBox: face })));
    const moved = zooms.map((zoom, index) => (zoom ? index : -1)).filter((index) => index >= 0);
    expect(moved.length).toBeGreaterThanOrEqual(2);
    expect(moved[0]).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < moved.length; i++) expect(moved[i] - moved[i - 1]).toBeGreaterThan(1);
    expect(zooms[moved[0]]?.style).toBe("slow");
    expect(zooms[moved[1]]?.style).toBe("pan");
  });

  it("1秒未満のクリップでは寄らない。AIのままのルールは寄りを変えない", () => {
    const short = [{ durationInSeconds: 0.6, cameraHighlight: true }];
    expect(applyCameraRule("lively", short)).toEqual([undefined]);
    const aiZoom = { scale: 1.3, style: "slow" as const, focusXPercent: 10, focusYPercent: 10 };
    expect(applyCameraRule("ai", [{ durationInSeconds: 2, zoom: aiZoom }])).toEqual([aiZoom]);
  });

  it("テンプレートから既定のルールを選び、おまかせはAIのまま", () => {
    expect(cameraRuleForTemplate("ranking")).toBe("ranking");
    expect(cameraRuleForTemplate("two-choice")).toBe("two-choice");
    expect(cameraRuleForTemplate(null)).toBe("ai");
  });
});
