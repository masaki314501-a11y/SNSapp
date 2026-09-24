import { access, cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";

/**
 * Dockerのビルド時に作っておくRemotionのバンドル(Dockerfile参照)。本番ではこれをそのまま使い、
 * 実行時にはbundle()を走らせない。bundle()はwebpackを動かすため数百MBのメモリを使い、
 * Render無料プラン(512MB)ではヘッドレスChromeの起動と重なってサーバーごと落ち、画面に
 * "The string did not match the expected pattern."(応答がJSONでない)と出て書き出せなかった。
 */
export const PREBUILT_BUNDLE_DIR = path.join(process.cwd(), ".remotion-bundle");

/**
 * バンドルに含める静的ファイルはフォントだけにする。bundle()は既定でpublic/を丸ごとコピーするため、
 * アップロード動画(public/videos)や過去の書き出し(public/renders)まで毎回コピーしていた
 * (手元で計942MB)。動画・音声はレンダー時に/api/media経由の絶対URLで読むのでバンドルには不要。
 */
const createFontsOnlyPublicDir = async (): Promise<string> => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "remotion-public-"));
  await cp(path.join(process.cwd(), "public", "fonts"), path.join(publicDir, "fonts"), { recursive: true });
  return publicDir;
};

const exists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false
  );

/**
 * @remotion/bundler の bundle() は1回あたり数秒〜十数秒かかるため、
 * 開発サーバのプロセス内でキャッシュして使い回す(リクエストごとの再バンドルを避ける)。
 */
let serveUrlPromise: Promise<string> | null = null;

export const getServeUrl = (): Promise<string> => {
  if (!serveUrlPromise) {
    serveUrlPromise = (async () => {
      // 開発中はテンプレートの変更がすぐ反映されるよう、残っていても組み立て済みバンドルは使わない。
      if (process.env.NODE_ENV === "production" && (await exists(path.join(PREBUILT_BUNDLE_DIR, "index.html")))) {
        return PREBUILT_BUNDLE_DIR;
      }
      return bundle({
        entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
        publicDir: await createFontsOnlyPublicDir(),
        onProgress: () => {},
      });
    })().catch((error: unknown) => {
      serveUrlPromise = null;
      throw error;
    });
  }

  return serveUrlPromise;
};
