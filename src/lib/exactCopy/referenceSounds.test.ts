import { describe, expect, it } from "vitest";
import { changePeaks, matchReferenceSounds, withReferenceSounds } from "./referenceSounds";
import type { ReferenceTemplate } from "@/lib/editSteps/template";

describe("手本の効果音の結び付け", () => {
  it("字幕が変わった時に鳴り、すぐ後にその見た目を読んだ音を、その見た目の音にする", () => {
    const matched = matchReferenceSounds({
      sounds: [{ start: 1.7 }, { start: 8.25 }, { start: 24.5 }, { start: 30.95 }, { start: 51.15 }],
      captionChanges: [8.3, 24.45, 40.0, 51.2],
      styleSeen: [[24.5, 25.5, 40.5], [9.0, 10.0], [33.5]],
      stageStarts: [49.0, 51.25],
    });
    // 1.7秒は字幕が変わっていない・30.95秒は字幕が変わっていないので結び付けない
    expect(matched.styles).toEqual([2, 1, null]);
    expect(matched.closing).toBe(4);
  });

  it("1つの見た目には、最初に結び付いた音だけを使う", () => {
    const matched = matchReferenceSounds({
      sounds: [{ start: 5 }, { start: 12 }],
      captionChanges: [5.1, 12.0],
      styleSeen: [[5.5, 12.5]],
      stageStarts: [],
    });
    expect(matched.styles).toEqual([0]);
    expect(matched.closing).toBeNull();
  });

  it("明るさが大きく変わった時刻を、近い物はまとめて拾う", () => {
    const diffs = [0, 1, 30, 25, 1, 1, 1, 1, 1, 15, 2];
    expect(changePeaks(diffs, 20, 10)).toEqual([0.1, 0.45]);
  });

  it("結び付いた音を型に入れる(結び付かない見た目は音なし)", () => {
    const template = {
      emphasisStyles: [
        { role: "項目の名前", fontFamily: "Noto Sans JP", textColor: "#FFFFFF", bandColor: null },
        { role: "強み", fontFamily: "Noto Sans JP", textColor: "#FFFF00", bandColor: null },
      ],
    } as unknown as ReferenceTemplate;
    const result = withReferenceSounds(
      template,
      "abc",
      { sounds: [{ file: "cand00.wav", start: 1, length: 0.5, db: 10 }, { file: "cand03.wav", start: 51, length: 0.9, db: 12 }], bgm: "bgm.wav" },
      { styles: [0, null], closing: 1 }
    );
    expect(result.emphasisStyles[0].sound).toBe("exact:audio/exact-sfx/abc/cand00.wav");
    expect(result.emphasisStyles[1].sound).toBeUndefined();
    expect(result.closingSound).toBe("exact:audio/exact-sfx/abc/cand03.wav");
    expect(result.sounds).toHaveLength(2);
    expect(result.bgm).toEqual({ src: "audio/exact-sfx/abc/bgm.wav", volume: 1 });
  });
});

describe("手本の効果音の見分け方", () => {
  it("音の始めに画面が変わらない音は使わない", () => {
    const screen = Array.from({ length: 200 }, () => 0.5);
    screen[Math.round(8.3 * 20)] = 12; // 8.3秒にだけ画面が変わる
    const matched = matchReferenceSounds({
      sounds: [{ start: 1.7 }, { start: 8.25 }],
      captionChanges: [1.75, 8.3],
      styleSeen: [[2.5], [9.0]],
      stageStarts: [],
      screen,
    });
    expect(matched.styles).toEqual([null, 1]);
  });

  it("強調にも締めにも結び付かず3回以上鳴った同じ音を、毎回同じに鳴らす音にする", () => {
    const matched = matchReferenceSounds({
      sounds: [{ start: 2, group: 0 }, { start: 5, group: 1 }, { start: 9, group: 0 }, { start: 14, group: 0 }, { start: 20, group: 1 }],
      captionChanges: [5.1],
      styleSeen: [[5.5]],
      stageStarts: [],
    });
    expect(matched.styles).toEqual([1]);
    expect(matched.structure).toBe(0);
  });

  it("3回未満なら、毎回同じに鳴らす音は無し", () => {
    const matched = matchReferenceSounds({ sounds: [{ start: 2, group: 0 }, { start: 9, group: 0 }], captionChanges: [], styleSeen: [], stageStarts: [] });
    expect(matched.structure).toBeNull();
  });
});
