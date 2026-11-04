import { describe, expect, it } from "vitest";
import type { ProjectSegment } from "@/lib/videoProject";
import {
  applyEmphasis,
  buildObjects,
  chinCaptionY,
  emphasisEffects,
  framingForFace,
  placeMainFootage,
  removeLongSilences,
  removeRanges,
  smoothJoins,
  splitByCaptions,
  trimBeforeSpeech,
  FACE_TARGET_Y_PERCENT,
} from "./logic";

let counter = 0;
const newKey = () => `k${++counter}`;
const seg = (start: number, end: number, key = newKey()): ProjectSegment => ({
  key,
  caption: "",
  startFromSeconds: start,
  durationInSeconds: end - start,
  captionAnimation: "pop",
  volume: 1,
});
const ranges = (segments: ProjectSegment[]) =>
  segments.map((s) => [s.startFromSeconds, Math.round((s.startFromSeconds + s.durationInSeconds) * 100) / 100]);

describe("工程ごとの編集(機械でやる工程)", () => {
  it("1. カットで残した範囲を順に並べる", () => {
    const placed = placeMainFootage(
      [
        { startFromSeconds: 0, durationInSeconds: 10 },
        { startFromSeconds: 15, durationInSeconds: 5 },
      ],
      newKey
    );
    expect(ranges(placed)).toEqual([
      [0, 10],
      [15, 20],
    ]);
  });

  it("2. 話し始める前を切る(話し声の無い先頭のクリップは外す)", () => {
    const { segments, removedSeconds } = trimBeforeSpeech([seg(0, 2), seg(3, 10)], [[4.2, 6]]);
    expect(ranges(segments)).toEqual([[4.05, 10]]);
    expect(removedSeconds).toBeCloseTo(3.05, 2);
  });

  it("3. 言い間違いの範囲を取り除くと、クリップが前後に分かれる", () => {
    const segments = removeRanges([seg(0, 10)], [{ start: 3, end: 4.5 }], newKey);
    expect(ranges(segments)).toEqual([
      [0, 3],
      [4.5, 10],
    ]);
  });

  it("4. 0.5秒以上の無音を、前後に少し余白を残して切る(短い間は残す)", () => {
    const { segments, count } = removeLongSilences(
      [seg(0, 10)],
      [
        [0, 2],
        [2.3, 4],
        [6, 9],
      ],
      newKey
    );
    // 2〜2.3秒の間(0.3秒)は残し、4〜6秒と9秒〜最後の無音を切る
    expect(count).toBe(2);
    expect(ranges(segments)).toEqual([
      [0, 4.12],
      [5.88, 9.12],
    ]);
  });

  it("5. 切れ目を静かな所へ寄せ、短すぎるクリップを外し、続いているクリップはまとめる", () => {
    const { segments, dropped, merged } = smoothJoins(
      [seg(0, 3), seg(3, 3.1), seg(3.1, 6), seg(8, 10)],
      (seconds) => seconds
    );
    expect(dropped).toBe(1);
    expect(merged).toBe(0);
    expect(ranges(segments)).toEqual([
      [0, 3],
      [3.1, 6],
      [8, 10],
    ]);
    const joined = smoothJoins([seg(0, 3), seg(3, 6)], (seconds) => seconds);
    expect(joined.merged).toBe(1);
    expect(ranges(joined.segments)).toEqual([[0, 6]]);
  });

  it("6. 顔が低い時だけ、顔の中心が縦40%に来るように寄せる", () => {
    expect(framingForFace({ xPercent: 50, yPercent: 40, widthPercent: 30, heightPercent: 20 })).toBeNull();
    const face = { xPercent: 50, yPercent: 55, widthPercent: 30, heightPercent: 20 };
    const framing = framingForFace(face)!;
    const movedY = framing.focusYPercent + (face.yPercent - framing.focusYPercent) * framing.scale;
    expect(movedY).toBeCloseTo(FACE_TARGET_Y_PERCENT, 1);
    expect(framing.scale).toBeGreaterThan(1);
  });

  it("7. テロップは顎のすぐ下に固定する(収まらなければnull)", () => {
    const look = { style: "outline" as const, fontSize: "medium" as const };
    const y = chinCaptionY({ xPercent: 50, yPercent: 35, widthPercent: 30, heightPercent: 20 }, null, look)!;
    // 顔の範囲は上下に余白(高さの15%ずつ)を付けて見るので、顎は 35 + 10×1.3 = 48%。その1%下
    expect(y).toBeCloseTo(49, 1);
    expect(chinCaptionY({ xPercent: 50, yPercent: 85, widthPercent: 30, heightPercent: 20 }, null, look)).toBeNull();
  });

  it("8. タイトルとランキングの枠を、テロップの帯より上に並べる", () => {
    const { globalOverlays, globalShapes } = buildObjects({ title: "医療用語5選", frameCount: 5, captionTopPercent: 55, accentColor: "#FF3366" });
    expect(globalOverlays[0].text).toBe("医療用語5選");
    expect(globalShapes).toHaveLength(5);
    expect(globalOverlays.slice(1).map((o) => o.text)).toEqual(["1", "2", "3", "4", "5"]);
    const lowest = Math.max(...globalShapes.map((s) => s.yPercent + s.heightPercent / 2));
    expect(lowest).toBeLessThanOrEqual(53.01);
    expect(buildObjects({ title: "解説", frameCount: 0, captionTopPercent: 55, accentColor: "#FF3366" }).globalShapes).toHaveLength(0);
  });

  it("8. テロップが顎の下(画面の途中)にある時は、枠をテロップの上と下に分けて並べ、帯には置かない", () => {
    const { globalShapes } = buildObjects({ title: "医療用語5選", frameCount: 5, captionTopPercent: 45, captionBottomPercent: 52, accentColor: "#FF3366" });
    expect(globalShapes).toHaveLength(5);
    for (const shape of globalShapes) {
      const top = shape.yPercent - shape.heightPercent / 2;
      const bottom = shape.yPercent + shape.heightPercent / 2;
      expect(bottom <= 43.01 || top >= 53.99, `枠(${top}〜${bottom})がテロップの帯にかかっている`).toBe(true);
      expect(bottom).toBeLessThanOrEqual(77.01);
    }
    // 帯の上だけに詰めた時(1つ約4%)より、ずっと大きい
    expect(globalShapes[0].heightPercent).toBeGreaterThan(7);
  });

  it("9. 書き起こしのかたまりごとにクリップを分けて字幕を入れる", () => {
    const segments = splitByCaptions(
      [seg(0, 6)],
      [
        { start: 0.2, end: 2.5, text: "こんにちは" },
        { start: 2.6, end: 5.8, text: "今日は歯の話です" },
      ],
      newKey
    );
    expect(segments.map((s) => s.caption)).toEqual(["こんにちは", "今日は歯の話です"]);
    expect(ranges(segments)).toEqual([
      [0, 2.6],
      [2.6, 6],
    ]);
  });

  it("10・11. 強調テロップにしたクリップだけ、効果音と少しの寄りを付ける", () => {
    const a = seg(0, 2, "a");
    const b = seg(2, 4, "b");
    const emphasized = applyEmphasis([a, b], new Set(["b"]));
    const { segments, count } = emphasisEffects(emphasized);
    expect(count).toBe(1);
    expect(segments[0].captionEmphasis).toBeUndefined();
    expect(segments[0].zoom).toBeUndefined();
    expect(segments[1].captionEmphasis?.band).toBe(true);
    expect(segments[1].emphasisSfxPresetId).toBe("pop");
    expect(segments[1].zoom?.scale).toBe(1.1);
  });
});
