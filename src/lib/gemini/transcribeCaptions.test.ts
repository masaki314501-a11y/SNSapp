import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transcribeCaptions } from "./transcribeCaptions";

describe("transcribeCaptions (GEMINI_MOCK)", () => {
  const originalMock = process.env.GEMINI_MOCK;
  const originalApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.GEMINI_MOCK = "1";
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.GEMINI_MOCK;
    else process.env.GEMINI_MOCK = originalMock;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  });

  it("GEMINI_API_KEY未設定・ファイル未アクセスでも動画長をカバーするダミーセグメントを返す", async () => {
    const phases: string[] = [];
    const segments = await transcribeCaptions({
      absoluteVideoPath: "/does/not/exist.mp4",
      mimeType: "video/mp4",
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
