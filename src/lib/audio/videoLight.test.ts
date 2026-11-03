import { describe, expect, it } from "vitest";
import { lightAdjustFor } from "./videoLight";

describe("光の補正", () => {
  it("暗い映像は明るくし、ちょうど良い明るさなら明るさは変えない", () => {
    expect(lightAdjustFor(95, 60)?.brightness).toBeCloseTo(1.32, 2);
    expect(lightAdjustFor(125, 60)?.brightness).toBe(1);
    // 明るすぎる映像は少しだけ落とす(人を暗くしすぎない)
    expect(lightAdjustFor(200, 60)?.brightness).toBe(0.95);
    // 顔を測った時は、肌が明るく見える目標(150)に合わせる
    expect(lightAdjustFor(125, 60, 150)?.brightness).toBe(1.2);
  });

  it("メリハリの無い映像はコントラストを少し上げる", () => {
    expect(lightAdjustFor(125, 30)?.contrast).toBe(1.08);
    expect(lightAdjustFor(125, 60)?.contrast).toBe(1);
  });
});
