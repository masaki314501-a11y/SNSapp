import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateVoiceover } from "./generateVoiceover";

describe("generateVoiceover (GEMINI_MOCK)", () => {
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

  it("GEMINI_API_KEY未設定でも有効なWAVバッファを返す", async () => {
    const wav = await generateVoiceover({ text: "テスト", voiceName: "Kore" });
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(44);
  });
});
