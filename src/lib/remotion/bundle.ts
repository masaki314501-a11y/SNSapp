import path from "node:path";
import { bundle } from "@remotion/bundler";

/**
 * @remotion/bundler の bundle() は1回あたり数秒〜十数秒かかるため、
 * 開発サーバのプロセス内でキャッシュして使い回す(リクエストごとの再バンドルを避ける)。
 */
let serveUrlPromise: Promise<string> | null = null;

export const getServeUrl = (): Promise<string> => {
  if (!serveUrlPromise) {
    serveUrlPromise = bundle({
      entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
      onProgress: () => {},
    }).catch((error: unknown) => {
      serveUrlPromise = null;
      throw error;
    });
  }

  return serveUrlPromise;
};
