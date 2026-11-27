/**
 * 手本にする動画から、効果音の候補とBGMを前もって切り出しておく(public/audio/exact-sfx/<手本のID>/)。
 * 手本のIDは、アップロードした時と同じく動画の中身から決まるので、同じ動画を手本にすれば、
 * 声を分ける Python が無い所(本番)でも、切り出しておいた音を使える。
 * 使い方: SOUND_SEPARATION_PYTHON=.venv-sound/bin/python npx vite-node --config vitest.config.ts scripts/prepare-reference-sounds.ts -- <動画> [<動画> ...]
 */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { cutReferenceSounds } from "@/lib/exactCopy/referenceSounds";

const idOf = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex").slice(0, 32)))
      .on("error", reject);
  });

const files = process.argv.slice(2).filter((arg) => arg !== "--").map((file) => path.resolve(file));
const done = new Set<string>();
for (const file of files) {
  const id = await idOf(file);
  if (done.has(id)) continue;
  done.add(id);
  const result = await cutReferenceSounds(file, id);
  console.log(`${id} ${result ? `効果音の候補${result.sounds.length}個` : "切り出せませんでした"} ${file}`);
}
process.exit(0);
