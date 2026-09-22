import { describe, expect, it } from "vitest";
import { GEMINI_API_KEY_HEADER, readGeminiApiKeyOverride } from "./apiKeyHeader";

describe("readGeminiApiKeyOverride", () => {
  it("ヘッダーに値があればそれを返す", () => {
    const request = new Request("http://localhost/api/x", {
      headers: { [GEMINI_API_KEY_HEADER]: "my-own-key" },
    });
    expect(readGeminiApiKeyOverride(request)).toBe("my-own-key");
  });

  it("ヘッダーが無ければundefinedを返す", () => {
    const request = new Request("http://localhost/api/x");
    expect(readGeminiApiKeyOverride(request)).toBeUndefined();
  });

  it("空白のみのヘッダーはundefinedを返す", () => {
    const request = new Request("http://localhost/api/x", {
      headers: { [GEMINI_API_KEY_HEADER]: "   " },
    });
    expect(readGeminiApiKeyOverride(request)).toBeUndefined();
  });
});
