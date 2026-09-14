import { describe, expect, it } from "vitest";
import {
  MIN_SEGMENT_DURATION_IN_SECONDS,
  canMergeWithNext,
  canSplitSegment,
  clampTrimEnd,
  clampTrimStart,
  clipTranscribedToKeepRanges,
  findLargestGap,
  mergeWithNext,
  splitSegment,
} from "./timelineUtils";

describe("canMergeWithNext", () => {
  it("結合可能: 隣接クリップが元動画上で連続していて合計尺が上限以内", () => {
    const segments = [
      { startFromSeconds: 0, durationInSeconds: 5 },
      { startFromSeconds: 5, durationInSeconds: 3 },
    ];
    expect(canMergeWithNext(segments, 0)).toBe(true);
  });

  it("結合不可: 元動画上で連続していない", () => {
    const segments = [
      { startFromSeconds: 0, durationInSeconds: 5 },
      { startFromSeconds: 6, durationInSeconds: 3 },
    ];
    expect(canMergeWithNext(segments, 0)).toBe(false);
  });

  it("結合不可: 合計尺が上限(30秒)を超える", () => {
    const segments = [
      { startFromSeconds: 0, durationInSeconds: 20 },
      { startFromSeconds: 20, durationInSeconds: 15 },
    ];
    expect(canMergeWithNext(segments, 0)).toBe(false);
  });

  it("結合不可: 次のクリップが存在しない(末尾)", () => {
    const segments = [{ startFromSeconds: 0, durationInSeconds: 5 }];
    expect(canMergeWithNext(segments, 0)).toBe(false);
  });
});

describe("mergeWithNext", () => {
  it("尺を合算し、両方のcaptionを空白区切りで連結する", () => {
    const segments = [
      { startFromSeconds: 0, durationInSeconds: 5, caption: "a" },
      { startFromSeconds: 5, durationInSeconds: 3, caption: "b" },
    ];
    expect(mergeWithNext(segments, 0)).toEqual([
      { startFromSeconds: 0, durationInSeconds: 8, caption: "a b" },
    ]);
  });

  it("片方のcaptionが空なら非空側のみを使う", () => {
    const segments = [
      { startFromSeconds: 0, durationInSeconds: 5, caption: "" },
      { startFromSeconds: 5, durationInSeconds: 3, caption: "b" },
    ];
    expect(mergeWithNext(segments, 0)[0].caption).toBe("b");
  });
});

describe("canSplitSegment", () => {
  const segment = { startFromSeconds: 0, durationInSeconds: 2 };

  it("前後ともに最小尺(0.5秒)以上なら分割可能", () => {
    expect(canSplitSegment(segment, 1)).toBe(true);
  });

  it("前半が最小尺未満なら分割不可", () => {
    expect(canSplitSegment(segment, 0.3)).toBe(false);
  });

  it("後半が最小尺未満なら分割不可", () => {
    expect(canSplitSegment(segment, 1.8)).toBe(false);
  });
});

describe("splitSegment", () => {
  it("指定オフセットで前後2クリップに分割する(後半は新キー・空caption)", () => {
    const segments = [
      { key: "a", startFromSeconds: 0, durationInSeconds: 4, caption: "hello" },
    ];
    expect(splitSegment(segments, 0, 1.5, "b")).toEqual([
      { key: "a", startFromSeconds: 0, durationInSeconds: 1.5, caption: "hello" },
      { key: "b", startFromSeconds: 1.5, durationInSeconds: 2.5, caption: "" },
    ]);
  });
});

describe("findLargestGap", () => {
  it("最大の空き区間を返す", () => {
    const segments = [{ startFromSeconds: 2, durationInSeconds: 3 }];
    expect(findLargestGap(segments, 10)).toEqual({ start: 5, size: 5 });
  });

  it("隙間が無ければnull", () => {
    const segments = [{ startFromSeconds: 0, durationInSeconds: 10 }];
    expect(findLargestGap(segments, 10)).toBeNull();
  });

  it("隙間が0.05秒以下ならnull(丸め誤差レベルの隙間は無視)", () => {
    const segments = [{ startFromSeconds: 0, durationInSeconds: 4.97 }];
    expect(findLargestGap(segments, 5)).toBeNull();
  });
});

describe("clipTranscribedToKeepRanges", () => {
  it("keepRangesに収まる範囲だけを切り詰めて残す(境界をまたぐ場合はトリム)", () => {
    const transcribed = [
      { key: "1", startFromSeconds: 0, durationInSeconds: 2, caption: "a" },
      { key: "2", startFromSeconds: 2, durationInSeconds: 2, caption: "b" },
      { key: "3", startFromSeconds: 4, durationInSeconds: 2, caption: "c" },
    ];
    const keepRanges = [{ startFromSeconds: 1, durationInSeconds: 4 }];
    expect(clipTranscribedToKeepRanges(transcribed, keepRanges)).toEqual([
      { key: "1", startFromSeconds: 1, durationInSeconds: 1, caption: "a" },
      { key: "2", startFromSeconds: 2, durationInSeconds: 2, caption: "b" },
      { key: "3", startFromSeconds: 4, durationInSeconds: 1, caption: "c" },
    ]);
  });

  it("range境界での切り詰めで下限(0.3秒)を下回ったクリップは同じrange内の隣接クリップに吸収する", () => {
    const transcribed = [
      { key: "1", startFromSeconds: 0, durationInSeconds: 2, caption: "a" },
      { key: "2", startFromSeconds: 2, durationInSeconds: 2, caption: "b" },
    ];
    // keepRangeは1.9秒目〜4.0秒目。segment "1" はここで0.1秒しか残らない(下限0.3未満)。
    const keepRanges = [{ startFromSeconds: 1.9, durationInSeconds: 2.1 }];
    const result = clipTranscribedToKeepRanges(transcribed, keepRanges);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("2");
    expect(result[0].caption).toBe("a b");
    expect(result[0].startFromSeconds).toBeCloseTo(1.9);
    expect(result[0].durationInSeconds).toBeCloseTo(2.1);
  });

  it("カットで捨てた範囲(keepRangesの外)は結果に含まれない", () => {
    const transcribed = [
      { key: "1", startFromSeconds: 0, durationInSeconds: 2, caption: "a" },
      { key: "2", startFromSeconds: 8, durationInSeconds: 2, caption: "b" },
    ];
    const keepRanges = [{ startFromSeconds: 0, durationInSeconds: 2 }];
    const result = clipTranscribedToKeepRanges(transcribed, keepRanges);
    expect(result.map((s) => s.key)).toEqual(["1"]);
  });
});

describe("clampTrimStart", () => {
  const sorted = [
    { startFromSeconds: 0, durationInSeconds: 5 },
    { startFromSeconds: 5, durationInSeconds: 5 },
  ];

  it("前のクリップの終端より前へはドラッグできない", () => {
    expect(clampTrimStart(1, sorted, 3)).toEqual({
      startFromSeconds: 5,
      durationInSeconds: 5,
    });
  });

  it("範囲内なら指定位置にクランプされる", () => {
    expect(clampTrimStart(1, sorted, 8)).toEqual({
      startFromSeconds: 8,
      durationInSeconds: 2,
    });
  });

  it("自身の終端 - 最小尺 を超えては伸ばせない", () => {
    const result = clampTrimStart(1, sorted, 9.8);
    expect(result.startFromSeconds).toBeCloseTo(9.5);
    expect(result.durationInSeconds).toBeCloseTo(MIN_SEGMENT_DURATION_IN_SECONDS);
  });
});

describe("clampTrimEnd", () => {
  const sorted = [
    { startFromSeconds: 0, durationInSeconds: 5 },
    { startFromSeconds: 5, durationInSeconds: 5 },
  ];

  it("次のクリップの開始位置を超えては伸ばせない", () => {
    expect(clampTrimEnd(0, sorted, 12, 8)).toBe(5);
  });

  it("最小尺を下回る指定は最小尺にクランプされる", () => {
    expect(clampTrimEnd(0, sorted, 12, 0.1)).toBe(MIN_SEGMENT_DURATION_IN_SECONDS);
  });

  it("末尾クリップは動画終端までクランプされる", () => {
    expect(clampTrimEnd(1, sorted, 12, 6)).toBe(6);
  });
});
