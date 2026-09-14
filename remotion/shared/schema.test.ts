import { describe, expect, it } from "vitest";
import { MEDIA_SRC_PATTERN } from "./schema";

describe("MEDIA_SRC_PATTERN", () => {
  it.each([
    "videos/24e13241-f565-42e7-99e5-124871396d84.mp4",
    "videos/abc-123.mov",
    "videos/abc-123.webm",
    "videos/abc-123.m4v",
    "audio/24e13241-f565-42e7-99e5-124871396d84.mp3",
    "audio/abc-123.wav",
    "audio/abc-123.m4a",
    "audio/abc-123.ogg",
    "audio/abc-123.aac",
    "audio/generated/24e13241-f565-42e7-99e5-124871396d84.wav",
    "audio/presets/sfx/tap.mp3",
    "audio/presets/sfx/notify.mp3",
  ])("実際に生成されるパス形式 %s を許可する", (value) => {
    expect(MEDIA_SRC_PATTERN.test(value)).toBe(true);
  });

  it.each([
    "../../../../etc/passwd",
    "videos/../../secret.mp4",
    "videos/../etc/passwd.mp4",
    "http://example.com/evil.mp4",
    "https://example.com/evil.mp4",
    "",
    "videos/abc-123.exe",
    "audio/presets/bgm/song.mp3",
    "VIDEOS/abc-123.mp4",
    "videos/abc-123.MP4",
  ])("不正な値 %s は拒否する", (value) => {
    expect(MEDIA_SRC_PATTERN.test(value)).toBe(false);
  });
});
