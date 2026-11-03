import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { breakLongSameAngle, runChecklist } from "./checklist";
import type { StepState } from "./logic";

let counter = 0;
const seg = (duration: number, extra: Partial<ProjectSegment> = {}): ProjectSegment => ({
  key: `c${++counter}`,
  caption: "",
  startFromSeconds: 0,
  durationInSeconds: duration,
  captionAnimation: "pop",
  volume: 1,
  ...extra,
});
/** 元の動画の秒数を、並べた順に続けて振る。 */
const timeline = (segments: ProjectSegment[]): ProjectSegment[] => {
  let t = 0;
  return segments.map((segment) => {
    const placed = { ...segment, startFromSeconds: t };
    t += segment.durationInSeconds;
    return placed;
  });
};
const state = (segments: ProjectSegment[], extra: Partial<StepState> = {}): StepState => ({
  segments: timeline(segments),
  framing: null,
  captionYPercent: 50,
  globalShapes: [],
  globalOverlays: [],
  ...extra,
});
const look = { captionStyle: "outline" as const, fontSize: "medium" as const, fontFamily: "Noto Sans JP" as const, primaryColor: "#FF3366" };
const item = (items: ReturnType<typeof runChecklist>["items"], id: string) => items.find((i) => i.id === id)!;

describe("工程12 チェック", () => {
  it("同じ画角が5秒を超えて続く所に、ゆるい寄りを足して画角を変える", () => {
    const { segments, fixed } = breakLongSameAngle(timeline([seg(2), seg(2), seg(2), seg(2)]));
    expect(fixed).toBe(1);
    expect(segments[2].zoom?.scale).toBe(1.08);
    expect(segments[0].zoom).toBeUndefined();
  });

  it("話し声に合わせて切れていて、短い動画なら自動の項目は○になる", () => {
    const segments = [1.5, 1.5, 1.5, 1.5].map((d, i) =>
      seg(d, { caption: `字幕${i}`, captionEmphasis: i === 1 ? { band: true } : undefined, emphasisSfxPresetId: i === 1 ? "pop" : undefined })
    );
    const spans: [number, number][] = [
      [0, 1.4],
      [1.5, 2.9],
      [3, 4.4],
      [4.5, 5.9],
    ];
    const { items } = runChecklist({ state: state(segments), spans, look, hasBgm: false });
    for (const id of ["caption-time", "no-blank-start", "first-5s", "same-angle", "cut-delay", "sfx", "length", "safe-zone"]) {
      expect(item(items, id).status, id).toBe("ok");
    }
    expect(item(items, "typo").status).toBe("review");
  });

  it("読めないほど短いテロップ・30秒を超える長さ・広告の言葉を見つける", () => {
    const segments = [seg(0.4, { caption: "とても長い字幕の文がここにある" }), seg(31, { caption: "最高の治療法で効果あり" })];
    const { items } = runChecklist({ state: state(segments), spans: [[0, 31.4]], look, hasBgm: false });
    expect(item(items, "caption-time").status).toBe("ng");
    expect(item(items, "length").status).toBe("review");
    expect(item(items, "ad-law").status).toBe("review");
    expect(item(items, "ad-law").detail).toContain("景品表示法");
  });

  it("下の端に出る字幕はセーフティゾーン外として×にする", () => {
    const { items } = runChecklist({
      state: state([seg(2, { caption: "字幕" })], { captionYPercent: null }),
      spans: [[0, 1.9]],
      look,
      hasBgm: false,
    });
    expect(item(items, "safe-zone").status).toBe("ng");
  });
});
