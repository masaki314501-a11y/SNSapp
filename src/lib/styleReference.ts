import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "./uploadedVideo";

/**
 * 参考画像(スクショ)の保存場所。以前はスタイル抽出が終わったら捨てていたが、自動編集が
 * 「この投稿者の編集の感じ」を最優先の手本として直接見られるよう、ファイルとして残す。
 * 参考動画は/api/uploadで既に public/videos/ に保存されているため、そのパスをそのまま使う。
 */
const REFERENCE_IMAGE_DIR = path.join(process.cwd(), "public", "references");

// パストラバーサル防止のため、保存時に付ける名前の形以外は受け付けない。
export const REFERENCE_IMAGE_PATH_PATTERN = /^references\/[0-9a-f-]+\.(png|jpg|webp)$/i;

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** 参考画像を保存し、public/配下の相対パスを返す。 */
export const saveReferenceImage = async (buffer: Buffer, mimeType: string): Promise<string> => {
  const ext = IMAGE_EXTENSION_BY_MIME[mimeType];
  if (!ext) throw new Error(`対応していない画像形式です: ${mimeType}`);
  await mkdir(REFERENCE_IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(REFERENCE_IMAGE_DIR, filename), buffer);
  return `references/${filename}`;
};

export const isStyleReferencePath = (referencePath: string): boolean =>
  REFERENCE_IMAGE_PATH_PATTERN.test(referencePath) || VIDEO_PATH_PATTERN.test(referencePath);

/** 参考画像/動画のパスを検証して絶対パス・MIMEタイプ・種別を返す。見つからなければnull。 */
export const resolveStyleReference = async (
  referencePath: string
): Promise<{ absolutePath: string; mimeType: string; kind: "image" | "video" } | null> => {
  if (VIDEO_PATH_PATTERN.test(referencePath)) {
    const video = await resolveUploadedVideo(referencePath);
    return video ? { ...video, kind: "video" } : null;
  }
  if (!REFERENCE_IMAGE_PATH_PATTERN.test(referencePath)) return null;
  const absolutePath = path.join(process.cwd(), "public", referencePath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return null;
  const ext = referencePath.split(".").pop()!.toLowerCase();
  return { absolutePath, mimeType: IMAGE_MIME_BY_EXTENSION[ext], kind: "image" };
};
