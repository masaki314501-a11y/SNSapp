import { describe, expect, it } from "vitest";
import { stepToRetry } from "./client";
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
