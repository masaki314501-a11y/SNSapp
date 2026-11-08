import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import { breakLongSameAngle, isSmallTypoFix, isWhiteOrBlack, runChecklist } from "./checklist";
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

  it("読めないほど短い字幕・広告の言葉を見つける(長さは上限を決めていなければ確かめない)", () => {
    const segments = [seg(0.4, { caption: "とても長い字幕の文がここにある" }), seg(31, { caption: "最高の治療法で効果あり" })];
    const { items } = runChecklist({ state: state(segments), spans: [[0, 31.4]], look, hasBgm: false });
    expect(item(items, "caption-time").status).toBe("ng");
    expect(item(items, "length").status).toBe("ok");
    expect(item(items, "ad-law").status).toBe("review");
    expect(item(items, "ad-law").findings?.map((finding) => finding.law)).toContain("景品表示法");
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

describe("色の数(白・黒は数えない)", () => {
  it("白・黒とそれに近い色だけを、白・黒とみなす", () => {
    for (const c of ["#FFFFFF", "#000000", "#111111", "#1a1a1a", "#F5F5F5", "#333333"]) expect(isWhiteOrBlack(c)).toBe(true);
    for (const c of ["#FF0000", "#3CB4E5", "#808080", "#FFFF00", "#1A1A3A"]) expect(isWhiteOrBlack(c)).toBe(false);
  });

  it("白・黒を除いて3色までなら○、4色なら×", () => {
    const shape = (borderColor: string) => ({ kind: "rect", xPercent: 20, yPercent: 50, widthPercent: 30, heightPercent: 10, borderColor, borderWidthPx: 4, fillColor: "#FFFFFF" }) as never;
    const base = { spans: [[0, 1.9]] as [number, number][], look, hasBgm: false };
    // 字幕の差し色(#FF3366)+枠の2色=3色。白い塗りと黒(#111111)は数えない
    const three = state([seg(2, { caption: "テスト" })], { globalShapes: [shape("#3CB4E5"), shape("#FFFF00"), shape("#111111")] });
    expect(item(runChecklist({ ...base, state: three }).items, "colors").status).toBe("ok");
    const four = state([seg(2, { caption: "テスト" })], { globalShapes: [shape("#3CB4E5"), shape("#FFFF00"), shape("#00AA00")] });
    expect(item(runChecklist({ ...base, state: four }).items, "colors").status).toBe("ng");
  });
});

describe("長さ(工程12で長さを指定した時だけ、その長さで確かめる)", () => {
  const base = { spans: [[0, 40]] as [number, number][], look, hasBgm: false };
  const long = state([seg(20, { caption: "前半" }), seg(20, { caption: "後半" })]);
  it("上限を決めていない時は、長くても確かめない", () => {
    expect(item(runChecklist({ ...base, state: long }).items, "length").status).toBe("ok");
  });
  it("指定した長さを超えていたら要修正、収まっていれば○", () => {
    expect(item(runChecklist({ ...base, state: long, targetSeconds: 30 }).items, "length").status).toBe("ng");
    expect(item(runChecklist({ ...base, state: long, targetSeconds: 45 }).items, "length").status).toBe("ok");
  });
});

describe("誤字・脱字の自動修正", () => {
  it("一部だけの小さな直しは自動で直し、ほとんど書き換える物は候補に残す", () => {
    expect(isSmallTypoFix({ text: "できるの", wrong: "できるの", correct: "できるので" })).toBe(true);
    expect(isSmallTypoFix({ text: "病院に行ったほがいい", wrong: "ほが", correct: "方が" })).toBe(true);
    expect(isSmallTypoFix({ text: "よくなる人も\nいます", wrong: "よくなる人もいます", correct: "この症状は病院に行った方がいい？" })).toBe(false);
    expect(isSmallTypoFix({ text: "胸の痛み", wrong: "腕", correct: "胸" })).toBe(false);
  });
});
