import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordGeminiDailyQuotaExceeded, recordGeminiUsage } from "./usageLog";

describe("usageLog", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("呼び出し内容とトークン数(思考トークン含む)をログに出力する", () => {
    recordGeminiUsage("extractStyle", "gemini-3.6-flash", {
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 50,
      totalTokenCount: 170,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("extractStyle");
    expect(line).toContain("gemini-3.6-flash");
    expect(line).toContain("100");
    expect(line).toContain("20");
    expect(line).toContain("50");
    expect(line).toContain("170");
  });

  it("トークン数が取得できなくても呼び出し自体は記録する", () => {
    recordGeminiUsage("generateVoiceover", "gemini-2.5-flash-preview-tts");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("generateVoiceover");
  });

  it("日次の無料枠上限到達を記録する", () => {
    recordGeminiDailyQuotaExceeded("transcribeCaptions");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("transcribeCaptions");
  });
});
