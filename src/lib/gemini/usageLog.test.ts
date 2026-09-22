import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, MediaModality } from "@google/genai";
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

  it("promptTokensDetailsがあればモダリティ別の内訳もログに出力する", () => {
    recordGeminiUsage("autoEditPlan", "gemini-3.6-flash", {
      promptTokenCount: 14663,
      candidatesTokenCount: 293,
      totalTokenCount: 14956,
      promptTokensDetails: [
        { modality: MediaModality.TEXT, tokenCount: 1200 },
        { modality: MediaModality.VIDEO, tokenCount: 13463 },
      ],
    });

    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("TEXT=1200");
    expect(line).toContain("VIDEO=13463");
  });

  it("トークン数が取得できなくても呼び出し自体は記録する", () => {
    recordGeminiUsage("generateVoiceover", "gemini-2.5-flash-preview-tts");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("generateVoiceover");
  });

  it("日次の無料枠上限到達を記録する", () => {
    recordGeminiDailyQuotaExceeded("transcribeCaptions", "gemini-3.6-flash");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("transcribeCaptions");
  });

  it("上限到達エラーからquotaValueを読み取れれば、以後のログに残り目安を出す", () => {
    const quotaExceededError = new ApiError({
      message: JSON.stringify({
        error: {
          code: 429,
          message: "Quota exceeded",
          status: "RESOURCE_EXHAUSTED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [
                {
                  quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                  quotaValue: "20",
                },
              ],
            },
          ],
        },
      }),
      status: 429,
    });

    recordGeminiDailyQuotaExceeded("autoEditPlan", "gemini-3.6-flash", quotaExceededError);
    expect(warnSpy.mock.calls[0][0]).toContain("残り目安=0/20回");

    recordGeminiUsage("autoEditPlan", "gemini-3.6-flash", {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
    // 上限到達直後にカウンタが上限へ揃えられているため、次の1回でも残りは0のまま。
    expect(logSpy.mock.calls[0][0]).toContain("残り目安=0/20回");
  });

  it("quotaValueが読み取れない場合は残り目安を出さない", () => {
    recordGeminiDailyQuotaExceeded("extractStyle", "gemini-3.6-flash");

    expect(warnSpy.mock.calls[0][0]).not.toContain("残り目安");
  });
});
