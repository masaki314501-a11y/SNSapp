import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ExtractedStyle } from "./styleTypes";
import type { ExtractStyleInput } from "./extractStyle";

// プロンプトやresponseSchemaを変えたら過去のキャッシュと結果の形が食い違うため、
// このバージョンを上げてキャッシュを無効化する。
const CACHE_KEY_VERSION = "v1";

/** プロセス内メモリのみのキャッシュ(extractStyleJobs.ts等と同じ制約)。 */
const cache = new Map<string, ExtractedStyle>();

/**
 * 同一の参考画像/動画に対してユーザーが何度もスタイル抽出をやり直しても、内容が
 * 同じであればGemini呼び出し自体を省けるよう、入力データのハッシュをキャッシュキーにする。
 */
export const computeExtractStyleCacheKey = async (input: ExtractStyleInput): Promise<string> => {
  const hash = createHash("sha256");
  hash.update(CACHE_KEY_VERSION);
  hash.update(input.kind);
  hash.update(input.mimeType);
  if (input.kind === "image") {
    hash.update(input.imageBase64);
  } else {
    hash.update(await readFile(input.absoluteVideoPath));
  }
  return hash.digest("hex");
};

export const getCachedExtractedStyle = (cacheKey: string): ExtractedStyle | undefined => cache.get(cacheKey);

export const setCachedExtractedStyle = (cacheKey: string, style: ExtractedStyle): void => {
  cache.set(cacheKey, style);
};
