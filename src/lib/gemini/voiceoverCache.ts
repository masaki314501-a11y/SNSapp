import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateVoiceover, resolveVoiceoverModel } from "./generateVoiceover";

const GENERATED_DIR = path.join(process.cwd(), "public", "audio", "generated");

/**
 * 同じ文言・同じ声・同じモデルなら音声も同じになるため、ファイル名を内容から決めて
 * 使い回せるようにする。無料枠のTTSは1日あたりの上限が厳しく、テロップを直して
 * 生成し直す・一括生成をやり直す・失敗した続きからやり直す、といった場面で
 * 同じ文言に何度も課金するのが上限到達の主因だった。
 * /api/generate-voiceover(手動生成)と自動編集の両方から呼ばれる共通ロジック。
 */
const cacheKeyFor = (text: string, voiceName: string): string =>
  createHash("sha256").update(`${resolveVoiceoverModel()} ${voiceName} ${text}`).digest("hex").slice(0, 32);

const fileExists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false
  );

export const getOrGenerateVoiceover = async (
  text: string,
  voiceName: string,
  apiKeyOverride?: string
): Promise<{ path: string; cached: boolean }> => {
  const filename = `${cacheKeyFor(text, voiceName)}.wav`;
  const absolutePath = path.join(GENERATED_DIR, filename);
  if (await fileExists(absolutePath)) {
    return { path: `audio/generated/${filename}`, cached: true };
  }

  const wavBuffer = await generateVoiceover({ text, voiceName, apiKeyOverride });
  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(absolutePath, wavBuffer);

  return { path: `audio/generated/${filename}`, cached: false };
};
