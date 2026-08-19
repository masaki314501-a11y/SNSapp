import { openBrowser, type HeadlessBrowser } from "@remotion/renderer";

/**
 * ヘッドレスChromeの起動はコストが大きい。selectComposition/renderMedia を
 * それぞれ別ブラウザインスタンスで独立に実行すると、CPUコアが少ない環境では
 * 起動負荷が重なりフォント読み込み等のdelayRenderがタイムアウトすることがあった。
 * Remotion CLI自身も1つのブラウザインスタンスを使い回す実装になっているため、
 * それに合わせてプロセス内でキャッシュして使い回す。
 */
let browserPromise: Promise<HeadlessBrowser> | null = null;

export const getBrowserInstance = (): Promise<HeadlessBrowser> => {
  if (!browserPromise) {
    browserPromise = openBrowser("chrome").catch((error: unknown) => {
      browserPromise = null;
      throw error;
    });
  }

  return browserPromise;
};
