import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { isTtsRefusedAudioError, toFriendlyGeminiError } from "./geminiErrors";

const ttsRefusedAudioErrorBody = {
  error: {
    code: 400,
    message:
      "Model tried to generate text, but it should only be used for TTS. Make sure your instructions are clear to only generate audio from a given text transcript.",
    status: "INVALID_ARGUMENT",
  },
};

describe("isTtsRefusedAudioError", () => {
  it("TTSがテキストで応答しようとした400と判定する", () => {
    const error = new ApiError({ message: JSON.stringify(ttsRefusedAudioErrorBody), status: 400 });
    expect(isTtsRefusedAudioError(error)).toBe(true);
  });

  it("同じメッセージでも400以外のステータスはfalseを返す", () => {
    const error = new ApiError({ message: JSON.stringify(ttsRefusedAudioErrorBody), status: 500 });
    expect(isTtsRefusedAudioError(error)).toBe(false);
  });

  it("無関係な400はfalseを返す", () => {
    const error = new ApiError({ message: "{}", status: 400 });
    expect(isTtsRefusedAudioError(error)).toBe(false);
  });
});

describe("toFriendlyGeminiError", () => {
  it("TTSがテキストで応答しようとした400には専門用語を避けたメッセージを返す", () => {
    const error = new ApiError({ message: JSON.stringify(ttsRefusedAudioErrorBody), status: 400 });
    const message = toFriendlyGeminiError(error).message;
    expect(message).toContain("音声に変換できません");
    expect(message).not.toContain("INVALID_ARGUMENT");
  });
});
