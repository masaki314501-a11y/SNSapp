import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { isDailyQuotaError, isRetryableApiError, toFriendlyGeminiError } from "./geminiErrors";

const dailyQuotaErrorBody = {
  error: {
    code: 429,
    message: "Quota exceeded",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateContentRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
    ],
  },
};

const minuteRateLimitErrorBody = {
  error: {
    code: 429,
    message: "Quota exceeded",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateContentRequestsPerMinutePerProjectPerModel-FreeTier" }],
      },
    ],
  },
};

describe("isDailyQuotaError", () => {
  it("quotaIdにPerDayを含む429は日次枠切れと判定する", () => {
    const error = new ApiError({ message: JSON.stringify(dailyQuotaErrorBody), status: 429 });
    expect(isDailyQuotaError(error)).toBe(true);
  });

  it("quotaIdにPerMinuteのみを含む429は日次枠切れと判定しない", () => {
    const error = new ApiError({ message: JSON.stringify(minuteRateLimitErrorBody), status: 429 });
    expect(isDailyQuotaError(error)).toBe(false);
  });

  it("429以外のステータスはfalseを返す", () => {
    const error = new ApiError({ message: JSON.stringify(dailyQuotaErrorBody), status: 503 });
    expect(isDailyQuotaError(error)).toBe(false);
  });

  it("ApiError以外のエラーはfalseを返す", () => {
    expect(isDailyQuotaError(new Error("boom"))).toBe(false);
  });
});

describe("isRetryableApiError", () => {
  it("日次枠切れの429はリトライ対象にしない", () => {
    const error = new ApiError({ message: JSON.stringify(dailyQuotaErrorBody), status: 429 });
    expect(isRetryableApiError(error)).toBe(false);
  });

  it("分単位のレート制限の429はこれまで通りリトライ対象にする", () => {
    const error = new ApiError({ message: JSON.stringify(minuteRateLimitErrorBody), status: 429 });
    expect(isRetryableApiError(error)).toBe(true);
  });

  it("503はリトライ対象にする", () => {
    const error = new ApiError({ message: "{}", status: 503 });
    expect(isRetryableApiError(error)).toBe(true);
  });

  it("それ以外のステータスはリトライ対象にしない", () => {
    const error = new ApiError({ message: "{}", status: 400 });
    expect(isRetryableApiError(error)).toBe(false);
  });
});

describe("toFriendlyGeminiError", () => {
  it("日次枠切れの429には専用メッセージを返す(専門用語を避けた表現)", () => {
    const error = new ApiError({ message: JSON.stringify(dailyQuotaErrorBody), status: 429 });
    const message = toFriendlyGeminiError(error).message;
    expect(message).toContain("本日使えるAIの回数");
    expect(message).not.toContain("クォータ");
    expect(message).not.toContain("レート制限");
  });

  it("分単位のレート制限には専門用語を避けたメッセージを返す", () => {
    const error = new ApiError({ message: JSON.stringify(minuteRateLimitErrorBody), status: 429 });
    const message = toFriendlyGeminiError(error).message;
    expect(message).toContain("集中してしまいました");
    expect(message).not.toContain("レート制限");
  });

  it("分単位のレート制限でretryDelayが返っていれば待ち秒数を見せる", () => {
    const body = {
      error: {
        code: 429,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateContentRequestsPerMinutePerProjectPerModel-FreeTier" }],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "43s" },
        ],
      },
    };
    const error = new ApiError({ message: JSON.stringify(body), status: 429 });
    expect(toFriendlyGeminiError(error).message).toContain("約43秒後");
  });

  it("503には専門用語を避けた混雑メッセージを返す", () => {
    const error = new ApiError({ message: "{}", status: 503 });
    const message = toFriendlyGeminiError(error).message;
    expect(message).toContain("混み合っていて");
  });

  it("401にはAPIキーが正しくない旨のメッセージを返す", () => {
    const error = new ApiError({ message: "{}", status: 401 });
    expect(toFriendlyGeminiError(error).message).toContain("APIキー");
  });

  it("403にはAPIキーが正しくない旨のメッセージを返す", () => {
    const error = new ApiError({ message: "{}", status: 403 });
    expect(toFriendlyGeminiError(error).message).toContain("APIキー");
  });
});
