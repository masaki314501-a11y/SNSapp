import { describe, expect, it } from "vitest";
import { createGeminiRateLimiter } from "./rateLimiter";

describe("createGeminiRateLimiter", () => {
  it("同じレーンでは指定した間隔より短い間隔で連続実行しない", async () => {
    const run = createGeminiRateLimiter(80);
    const start = Date.now();
    await run(async () => "a");
    await run(async () => "b");
    expect(Date.now() - start).toBeGreaterThanOrEqual(70);
  });

  it("呼び出しが失敗しても後続の呼び出しは継続する", async () => {
    const run = createGeminiRateLimiter(1);
    await expect(
      run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await expect(run(async () => "ok")).resolves.toBe("ok");
  });

  it("別レーンは互いの間隔に影響しない(TTSのような厳しい枠を独立させられる)", async () => {
    const slowLane = createGeminiRateLimiter(300);
    const fastLane = createGeminiRateLimiter(1);

    await slowLane(async () => "slow-1");
    const start = Date.now();
    await fastLane(async () => "fast-1");
    expect(Date.now() - start).toBeLessThan(100);
  });
});
