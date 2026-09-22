import { describe, expect, it } from "vitest";
import Groq, { APIError } from "groq-sdk";
import { GroqTimeoutError, isRetryableGroqError, toFriendlyGroqError } from "./groqErrors";

const makeApiError = (status: number, message = "{}"): APIError =>
  Groq.APIError.generate(status, { error: { message } }, message, new Headers());

describe("isRetryableGroqError", () => {
  it("429はリトライ対象にする", () => {
    expect(isRetryableGroqError(makeApiError(429))).toBe(true);
  });

  it("5xxはリトライ対象にする", () => {
    expect(isRetryableGroqError(makeApiError(503))).toBe(true);
  });

  it("401/403はリトライ対象にしない", () => {
    expect(isRetryableGroqError(makeApiError(401))).toBe(false);
    expect(isRetryableGroqError(makeApiError(403))).toBe(false);
  });

  it("GroqTimeoutErrorはリトライ対象にする", () => {
    expect(isRetryableGroqError(new GroqTimeoutError("timeout"))).toBe(true);
  });
});

describe("toFriendlyGroqError", () => {
  it("401/403には専門用語を避けたメッセージを返す", () => {
    const message = toFriendlyGroqError(makeApiError(401)).message;
    expect(message).toContain("AI機能");
    expect(message).not.toContain("APIキー");
  });

  it("429には専門用語を避けたメッセージを返す", () => {
    const message = toFriendlyGroqError(makeApiError(429)).message;
    expect(message).toContain("集中してしまいました");
  });

  it("503には専門用語を避けた混雑メッセージを返す", () => {
    const message = toFriendlyGroqError(makeApiError(503)).message;
    expect(message).toContain("混み合っていて");
  });

  it("GroqTimeoutErrorには時間がかかりすぎた旨のメッセージを返す", () => {
    const message = toFriendlyGroqError(new GroqTimeoutError("timeout")).message;
    expect(message).toContain("時間がかかりすぎた");
  });
});
