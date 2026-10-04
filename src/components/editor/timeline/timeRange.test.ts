import { describe, expect, it } from "vitest";
import { MIN_VISIBLE_SECONDS, fromOverlayTiming, toOverlayTiming } from "./timeRange";

describe("fromOverlayTiming", () => {
  it("表示秒数があれば、出現終了は開始+表示秒数", () => {
    expect(fromOverlayTiming({ startOffsetSeconds: 1, durationInSeconds: 2 }, 10)).toEqual({ start: 1, end: 3 });
  });

  it("表示秒数が無い(最後まで)なら、出現終了は範囲の終わり", () => {
    expect(fromOverlayTiming({ startOffsetSeconds: 1 }, 10)).toEqual({ start: 1, end: 10 });
  });

  it("範囲の外にはみ出した値は範囲内に収める", () => {
    expect(fromOverlayTiming({ startOffsetSeconds: 12, durationInSeconds: 5 }, 10)).toEqual({
      start: 10 - MIN_VISIBLE_SECONDS,
      end: 10,
    });
  });
});

describe("toOverlayTiming", () => {
  it("開始と終了から、開始秒と表示秒数に変換する", () => {
    expect(toOverlayTiming(1, 3, 10)).toEqual({ startOffsetSeconds: 1, durationInSeconds: 2 });
  });

  it("終了が範囲の終わりなら「最後まで」(表示秒数なし)にする", () => {
    expect(toOverlayTiming(1, 10, 10)).toEqual({ startOffsetSeconds: 1, durationInSeconds: undefined });
  });

  it("終了が開始より前にならないよう、最低の表示秒数を確保する", () => {
    expect(toOverlayTiming(5, 4, 10)).toEqual({ startOffsetSeconds: 5, durationInSeconds: MIN_VISIBLE_SECONDS });
  });

  it("開始は0より前・範囲の終わり間際より後にならない", () => {
    expect(toOverlayTiming(-1, 3, 10)).toEqual({ startOffsetSeconds: 0, durationInSeconds: 3 });
    expect(toOverlayTiming(10, 10, 10)).toEqual({
      startOffsetSeconds: 10 - MIN_VISIBLE_SECONDS,
      durationInSeconds: undefined,
    });
  });

  it("0.1秒単位に丸める", () => {
    expect(toOverlayTiming(1.234, 3.456, 10)).toEqual({ startOffsetSeconds: 1.2, durationInSeconds: 2.3 });
  });
});
