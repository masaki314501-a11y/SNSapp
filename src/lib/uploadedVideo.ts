import { createHash } from "node:crypto";
import { readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";

// アップロードAPI(src/app/api/upload/route.ts)が `videos/{id}.{ext}` の形式で
// 保存するため、それ以外のパスはパストラバーサル防止のため拒否する。
// idは中身のハッシュ(16進)。以前保存した動画はuuidなので、ハイフンも許す。
export const VIDEO_PATH_PATTERN = /^videos\/[0-9a-f-]+\.(mp4|mov|webm|m4v)$/i;

export const videosDir = () => path.join(process.cwd(), "public", "videos");

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
};

/** アップロード済み動画のvideoPathを検証し、絶対パスとMIMEタイプを解決する。存在しなければnull。 */
export const resolveUploadedVideo = async (
  videoPath: string
): Promise<{ absolutePath: string; mimeType: string } | null> => {
  const absolutePath = path.join(process.cwd(), "public", videoPath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return null;
  await markVideoUsed(absolutePath, fileStat.mtimeMs);
  const ext = videoPath.split(".").pop()!.toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[ext];
  return { absolutePath, mimeType };
};

/**
 * アップロード動画は、最後に使ってからこの日数たったら消す(UPLOAD_RETENTION_DAYS、既定7日。0なら消さない)。
 * 以前は消す仕組みが無く、同じ動画を何度も上げるとサーバーの容量(Render無料枠)を使い切って止められた。
 */
const DEFAULT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 「使った日」の書き直しは1時間に1回まで(動画の再生・シークのたびに書かないため)。 */
const MARK_USED_INTERVAL_MS = 60 * 60 * 1000;

export const retentionDays = (value = process.env.UPLOAD_RETENTION_DAYS): number => {
  if (value === undefined || value.trim() === "") return DEFAULT_RETENTION_DAYS;
  const days = Number(value);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_RETENTION_DAYS;
};

/** 動画を使った(開いた・AIに渡した)印として、ファイルの更新日時を今にする。消す日の判断はこの日時で行う。 */
export const markVideoUsed = async (absolutePath: string, mtimeMs: number, now = Date.now()): Promise<void> => {
  if (now - mtimeMs < MARK_USED_INTERVAL_MS) return;
  const date = new Date(now);
  await utimes(absolutePath, date, date).catch(() => {});
};

/** 最後に使ってから保存日数を過ぎた動画を消し、消した本数を返す。 */
export const removeOldVideos = async (dir = videosDir(), now = Date.now(), days = retentionDays()): Promise<number> => {
  if (days <= 0) return 0;
  const names = await readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    // 途中で止まったアップロードの仮ファイル(.〜.part)も、古ければ一緒に消す。
    if (name === ".gitkeep") continue;
    const filePath = path.join(dir, name);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile() || now - fileStat.mtimeMs < days * DAY_MS) continue;
    await unlink(filePath).then(() => removed++, () => {});
  }
  if (removed > 0) console.info(`[uploadedVideo] ${days}日使われていない動画を${removed}本消しました`);
  return removed;
};

/** 書き込みながら中身のハッシュを取る(同じ動画を見分けるため)。 */
export const createHashingStream = () => {
  const hash = createHash("sha256");
  const transform = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  };
  return { transform, digest: () => hash.digest("hex").slice(0, 32) };
};

/**
 * 書き終えた一時ファイルを、中身のハッシュの名前にする。同じ中身の動画が既にあれば一時ファイルを消して、そちらを使い回す。
 * 返り値はファイル名(`{hash}.{ext}`)。
 */
export const storeByHash = async (tempPath: string, hash: string, ext: string, dir = videosDir()): Promise<string> => {
  const filename = `${hash}.${ext}`;
  const finalPath = path.join(dir, filename);
  const existing = await stat(finalPath).catch(() => null);
  if (existing?.isFile()) {
    await unlink(tempPath).catch(() => {});
    await markVideoUsed(finalPath, 0);
  } else {
    await rename(tempPath, finalPath);
  }
  return filename;
};
