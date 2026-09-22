import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractStyle } from "./extractStyle";

describe("extractStyle (GEMINI_MOCK)", () => {
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

  it("GEMINI_API_KEY未設定でもダミーのスタイルを返す", async () => {
    const style = await extractStyle({ kind: "image", imageBase64: "AAAA", mimeType: "image/png" });
    expect(style.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(style.fontFamily).toBeTruthy();
    expect(style.captionPosition).toBeTruthy();
    expect(style.captionStyle).toBeTruthy();
    expect(style.captionAnimation).toBeTruthy();
  });

  it("video種別でもファイルにアクセスせずダミーのスタイルを返す", async () => {
    const style = await extractStyle({
      kind: "video",
      absoluteVideoPath: "/does/not/exist.mp4",
      mimeType: "video/mp4",
    });
    expect(style.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
