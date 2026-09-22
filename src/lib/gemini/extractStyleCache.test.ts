import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtractedStyle } from "./extractStyle";
import {
  computeExtractStyleCacheKey,
  getCachedExtractedStyle,
  setCachedExtractedStyle,
} from "./extractStyleCache";

describe("computeExtractStyleCacheKey", () => {
  it("同じ画像入力は同じキーになる", async () => {
    const input = { kind: "image", imageBase64: "AAAA", mimeType: "image/png" } as const;
    const a = await computeExtractStyleCacheKey(input);
    const b = await computeExtractStyleCacheKey(input);
    expect(a).toBe(b);
  });

  it("画像データが異なれば別のキーになる", async () => {
    const a = await computeExtractStyleCacheKey({ kind: "image", imageBase64: "AAAA", mimeType: "image/png" });
    const b = await computeExtractStyleCacheKey({ kind: "image", imageBase64: "BBBB", mimeType: "image/png" });
    expect(a).not.toBe(b);
  });

  it("同じ内容の動画ファイルは同じキーになる", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "extract-style-cache-test-"));
    const videoPath = path.join(dir, "sample.mp4");
    await writeFile(videoPath, Buffer.from("dummy video bytes"));
    const input = { kind: "video", absoluteVideoPath: videoPath, mimeType: "video/mp4" } as const;
    const a = await computeExtractStyleCacheKey(input);
    const b = await computeExtractStyleCacheKey(input);
    expect(a).toBe(b);
  });

  it("動画ファイルの内容が異なれば別のキーになる", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "extract-style-cache-test-"));
    const videoPathA = path.join(dir, "a.mp4");
    const videoPathB = path.join(dir, "b.mp4");
    await writeFile(videoPathA, Buffer.from("dummy video bytes A"));
    await writeFile(videoPathB, Buffer.from("dummy video bytes B"));
    const a = await computeExtractStyleCacheKey({ kind: "video", absoluteVideoPath: videoPathA, mimeType: "video/mp4" });
    const b = await computeExtractStyleCacheKey({ kind: "video", absoluteVideoPath: videoPathB, mimeType: "video/mp4" });
    expect(a).not.toBe(b);
  });
});

describe("getCachedExtractedStyle / setCachedExtractedStyle", () => {
  it("設定したスタイルを同じキーで取得できる", () => {
    const style: ExtractedStyle = {
      primaryColor: "#FF3366",
      fontFamily: "Noto Sans JP",
      captionPosition: "bottom",
      captionStyle: "pill",
      captionAnimation: "fade",
    };
    setCachedExtractedStyle("test-key-1", style);
    expect(getCachedExtractedStyle("test-key-1")).toEqual(style);
  });

  it("未設定のキーはundefinedを返す", () => {
    expect(getCachedExtractedStyle("does-not-exist-key")).toBeUndefined();
  });
});
