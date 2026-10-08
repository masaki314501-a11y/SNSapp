import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * 自動編集で使ってよい画像(本人が自動編集の画面で渡す、症例写真・商品写真など)。
 * 保存は動画に差し込む画像と同じ/api/upload-image(public/images/)を使う。
 * Geminiに見せられない形式(GIF)は受け付けない。
 */
export const MAX_MATERIAL_IMAGES = 20;

// パストラバーサル防止のため、/api/upload-imageが付ける名前の形以外は受け付けない。
export const MATERIAL_IMAGE_PATH_PATTERN = /^images\/[0-9a-f-]+\.(png|jpg|jpeg|webp)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export type ResolvedMaterialImage = {
  /** 動画に重ねるときのsrc(public/配下の相対パス)。 */
  path: string;
  /** 何の画像か(本人が付けた名前。空ならGeminiが画像を見て判断する)。 */
  name: string;
  absolutePath: string;
  mimeType: string;
};

/** 使える画像のパスを検証して絶対パス・MIMEタイプを返す。見つからなければnull。 */
export const resolveMaterialImage = async (image: {
  path: string;
  name: string;
}): Promise<ResolvedMaterialImage | null> => {
  if (!MATERIAL_IMAGE_PATH_PATTERN.test(image.path)) return null;
  const absolutePath = path.join(process.cwd(), "public", image.path);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) return null;
  const ext = image.path.split(".").pop()!.toLowerCase();
  return { path: image.path, name: image.name.trim(), absolutePath, mimeType: MIME_BY_EXTENSION[ext] };
};
