import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateEditExampleDigest } from "./editExampleDigest";

describe("generateEditExampleDigest (GEMINI_MOCK)", () => {
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

  it("GEMINI_API_KEY未設定・ファイル未アクセスでもダミーの要約を返す", async () => {
    const digest = await generateEditExampleDigest("/does/not/exist.mp4", "video/mp4");
    expect(digest.segments.length).toBeGreaterThan(0);
    expect(digest.segments[0].caption).toBeTruthy();
    expect(digest.summary).toBeTruthy();
  });
});
