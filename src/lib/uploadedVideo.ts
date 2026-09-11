import { stat } from "node:fs/promises";
import path from "node:path";

// アップロードAPI(src/app/api/upload/route.ts)が `videos/{uuid}.{ext}` の形式で
// 保存するため、それ以外のパスはパストラバーサル防止のため拒否する。
export const VIDEO_PATH_PATTERN = /^videos\/[0-9a-f-]+\.(mp4|mov|webm|m4v)$/i;

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
  const ext = videoPath.split(".").pop()!.toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[ext];
  return { absolutePath, mimeType };
};
