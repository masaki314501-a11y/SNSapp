import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrGenerateVoiceover } from "./voiceoverCache";

describe("getOrGenerateVoiceover (GEMINI_MOCK)", () => {
  const originalMock = process.env.GEMINI_MOCK;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const generatedDir = path.join(process.cwd(), "public", "audio", "generated");

  beforeEach(() => {
    process.env.GEMINI_MOCK = "1";
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(async () => {
    if (originalMock === undefined) delete process.env.GEMINI_MOCK;
    else process.env.GEMINI_MOCK = originalMock;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
    await rm(generatedDir, { recursive: true, force: true }).catch(() => {});
  });

  it("同じ文言・声質は2回目以降キャッシュされたファイルを返す", async () => {
    const text = `テスト-${randomUUID()}`;
    const first = await getOrGenerateVoiceover(text, "Kore");
    expect(first.cached).toBe(false);

    const second = await getOrGenerateVoiceover(text, "Kore");
    expect(second.cached).toBe(true);
    expect(second.path).toBe(first.path);
  });

  it("文言が異なれば別ファイルになる", async () => {
    const a = await getOrGenerateVoiceover(`テストA-${randomUUID()}`, "Kore");
    const b = await getOrGenerateVoiceover(`テストB-${randomUUID()}`, "Kore");
    expect(a.path).not.toBe(b.path);
  });
});
