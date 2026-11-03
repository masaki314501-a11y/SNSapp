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

  it("声の無い所の字幕・AIが見つけた誤字・受け取った画像・急に切れるBGMを見つける", () => {
    const segments = [seg(2, { caption: "こんにちは" }), seg(2, { caption: "無音の字幕", images: [{ src: "images/abc.png" } as never] })];
    const { items } = runChecklist({
      state: state(segments, { globalOverlays: [] }),
      spans: [[0, 1.9]],
      look,
      hasBgm: true,
      bgmFade: { fadeInSeconds: 0, fadeOutSeconds: 0 },
      typos: [{ text: "こんにちわ", wrong: "わ", correct: "は", reason: "誤字" }],
    });
    expect(item(items, "sync").status).toBe("ng");
    expect(item(items, "typo").status).toBe("ng");
    expect(item(items, "copyright").status).toBe("review");
    expect(item(items, "bgm").status).toBe("ng");
  });

  it("画像の棚の画像だけ・フェードアウトするBGM・誤字なし・光の補正済みなら○になる", () => {
    const segments = [seg(2, { caption: "こんにちは", images: [{ src: "images/library/a.png" } as never] })];
    const { items } = runChecklist({
      state: state(segments),
      spans: [[0, 1.9]],
      look,
      hasBgm: true,
      bgmFade: { fadeInSeconds: 0.3, fadeOutSeconds: 1.5 },
      typos: [],
      lightAdjusted: { brightness: 1.1, contrast: 1, saturation: 1.05 },
    });
    for (const id of ["sync", "typo", "copyright", "bgm", "light"]) expect(item(items, id).status, id).toBe("ok");
  });

  it("広告に出す時は、セーフティゾーンが狭くなる", () => {
    const segments = [seg(2, { caption: "こんにちは" })];
    const lowCaption = state(segments, { captionYPercent: 72 });
    expect(item(runChecklist({ state: lowCaption, spans: [[0, 1.9]], look, hasBgm: false }).items, "safe-zone").status).toBe("ok");
    expect(item(runChecklist({ state: lowCaption, spans: [[0, 1.9]], look, hasBgm: false, zone: "ad" }).items, "safe-zone").status).toBe("ng");
  });
});
