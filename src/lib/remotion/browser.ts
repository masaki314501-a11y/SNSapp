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
    const thisPromise: Promise<HeadlessBrowser> = openBrowser("chrome")
      .then((browser) => {
        // メモリの少ない本番環境(Render無料プラン)ではヘッドレスChromeが稀に
        // OOM Kill等で予期せず終了することがある。検知せずキャッシュし続けると、
        // 次のレンダーが死んだブラウザに接続しようとして分かりにくいエラーになる
        // (実際に発生していた"The string did not match the expected pattern."は
        // これが疑わしい)。終了を検知したらキャッシュを破棄し、次回は再起動させる。
        browser.once("closed", () => {
          if (browserPromise === thisPromise) browserPromise = null;
        });
        return browser;
      })
      .catch((error: unknown) => {
        if (browserPromise === thisPromise) browserPromise = null;
        throw error;
      });
    browserPromise = thisPromise;
  }

  return browserPromise;
};
