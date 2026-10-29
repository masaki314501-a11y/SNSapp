import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHashingStream, removeOldVideos, retentionDays, storeByHash } from "./uploadedVideo";

const DAY_MS = 24 * 60 * 60 * 1000;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "uploaded-video-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hashOf = async (text: string) => {
  const hashing = createHashingStream();
  const source = (async function* () {
    yield new TextEncoder().encode(text);
  })();
  for await (const chunk of hashing.transform(source)) void chunk;
  return hashing.digest();
};

describe("アップロード動画の片付け", () => {
  it("同じ中身の動画は、1つだけ保存して使い回す", async () => {
    const hash = await hashOf("same video");
    await writeFile(path.join(dir, "a.part"), "same video");
    const first = await storeByHash(path.join(dir, "a.part"), hash, "mp4", dir);
    await writeFile(path.join(dir, "b.part"), "same video");
    const second = await storeByHash(path.join(dir, "b.part"), hash, "mp4", dir);
    expect(second).toBe(first);
    expect(await readdir(dir)).toEqual([first]);
    expect(await hashOf("other video")).not.toBe(hash);
  });

  it("最後に使ってから保存日数を過ぎた動画だけ消す", async () => {
    const now = Date.now();
    for (const [name, ageDays] of [["old.mp4", 8], ["new.mp4", 2], [".gitkeep", 30]] as const) {
      const filePath = path.join(dir, name);
      await writeFile(filePath, name);
      const date = new Date(now - ageDays * DAY_MS);
      await utimes(filePath, date, date);
    }
    expect(await removeOldVideos(dir, now, 7)).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([".gitkeep", "new.mp4"]);
    expect(await removeOldVideos(dir, now + 30 * DAY_MS, 0)).toBe(0);
    expect((await stat(path.join(dir, "new.mp4"))).isFile()).toBe(true);
  });

  it("保存日数は既定7日で、0なら消さない・おかしな値なら既定に戻す", () => {
    expect(retentionDays(undefined)).toBe(7);
    expect(retentionDays("3")).toBe(3);
    expect(retentionDays("0")).toBe(0);
    expect(retentionDays("abc")).toBe(7);
  });
});
