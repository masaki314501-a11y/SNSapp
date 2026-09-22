import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capSegments, transcribeCaptions } from "./transcribeCaptions";

describe("transcribeCaptions (GEMINI_MOCK)", () => {
  const originalMock = process.env.GEMINI_MOCK;
  const originalApiKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_MOCK = "1";
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.GEMINI_MOCK;
    else process.env.GEMINI_MOCK = originalMock;
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("GROQ_API_KEY未設定・ファイル未アクセスでも動画長をカバーするダミーセグメントを返す", async () => {
    const phases: string[] = [];
    const segments = await transcribeCaptions({
      absoluteVideoPath: "/does/not/exist.mp4",
      videoDurationInSeconds: 30,
      minClips: 3,
      maxClips: 20,
      onProgress: (phase) => phases.push(phase),
    });

    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments[0].startFromSeconds).toBe(0);
    const total = segments.reduce((sum, s) => sum + s.durationInSeconds, 0);
    expect(total).toBeCloseTo(30, 5);
    expect(phases).toEqual(["uploading", "processing", "generating"]);
  });
});

describe("capSegments", () => {
  it("maxClips以内ならそのまま返す", () => {
    const segments = [
      { start: 0, end: 1, text: "a" },
      { start: 1, end: 2, text: "b" },
    ];
    expect(capSegments(segments, 5)).toEqual(segments);
  });

  it("maxClipsを超える場合は隣接セグメントを均等に統合する", () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 1, text: `s${i}` }));
    const capped = capSegments(segments, 4);

    expect(capped.length).toBeLessThanOrEqual(4);
    expect(capped[0].start).toBe(0);
    expect(capped[capped.length - 1].end).toBe(10);
    // 統合後も時系列の連続性(隙間や重複が無いこと)を保つ
    for (let i = 1; i < capped.length; i++) {
      expect(capped[i].start).toBe(capped[i - 1].end);
    }
  });
});
