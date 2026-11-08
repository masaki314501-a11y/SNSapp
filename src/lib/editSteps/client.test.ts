import { describe, expect, it } from "vitest";
import { replaceShownText, resumeStepOf, stepToRetry } from "./client";
import type { CheckItem } from "./checklist";

const check = (id: string, status: CheckItem["status"]): CheckItem => ({ id, group: "基本", label: id, status, detail: "" });

describe("自動で流した時に、やり直す工程", () => {
  it("要修正の項目のうち、やり直すと直る見込みがある一番前の工程を選ぶ", () => {
    expect(stepToRetry([check("sfx", "ng"), check("colors", "ng"), check("sync", "ok")])).toBe(8);
    expect(stepToRetry([check("typo", "ng")])).toBe(9);
  });

  it("やり直しても同じ項目(決まった計算の物)や、目で確かめる項目だけならやり直さない", () => {
    expect(stepToRetry([check("first-5s", "ng"), check("brand", "review")])).toBeNull();
    expect(stepToRetry([check("colors", "ok")])).toBeNull();
  });
});

describe("言い換え・続きから", () => {
  const seg = (caption: string) => ({ key: caption, startFromSeconds: 0, durationInSeconds: 1, caption });
  it("同じ文字の字幕・文字だけを書き換える", () => {
    const state = {
      segments: [seg("必ず\n治る"), seg("ほかの字幕")],
      framing: null,
      captionYPercent: null,
      globalShapes: [],
      globalOverlays: [{ text: "必ず治る" }, { text: "タイトル" }],
    } as unknown as Parameters<typeof replaceShownText>[0];
    const next = replaceShownText(state, "必ず治る", "よくなる人もいます");
    expect(next.segments.map((segment) => segment.caption)).toEqual(["よくなる人もいます", "ほかの字幕"]);
    expect(next.globalOverlays.map((overlay) => overlay.text)).toEqual(["よくなる人もいます", "タイトル"]);
  });
  it("途中まで終わっていれば、次の工程を返す", () => {
    const project = (steps: number[]) =>
      ({ editSteps: { results: Object.fromEntries(steps.map((step) => [step, { note: "", at: "" }])), snapshots: {} } }) as unknown as Parameters<typeof resumeStepOf>[0];
    expect(resumeStepOf(project([]))).toBeNull();
    expect(resumeStepOf(project([1, 2, 3]))).toBe(4);
    expect(resumeStepOf(project(Array.from({ length: 14 }, (_, i) => i + 1)))).toBeNull();
  });
});
