// 無料枠のGemini APIはRPM(1分あたりのリクエスト数)制限が厳しいため、テロップ生成・
// 文字起こしなど別々の機能から呼ばれても常にサーバープロセス全体で1件ずつ直列実行し、
// 呼び出し間に最低間隔を空けることでレート制限エラーを避ける。
// 4秒間隔(最大15 RPM相当)だと無料枠の上限に対してまだ攻めすぎで、AIナレーションの
// 「全クリップに一括生成」のようにクリップ数分バーストするケースでレート制限に
// 引っかかりやすかったため、余裕を持たせる(1分あたり約9件)。
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS) || 6_500;

let queue: Promise<unknown> = Promise.resolve();
let lastCallFinishedAt = 0;

export const runWithGeminiRateLimit = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(async () => {
    const waitMs = lastCallFinishedAt + MIN_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      return await fn();
    } finally {
      lastCallFinishedAt = Date.now();
    }
  });
  // 個々の呼び出しが失敗してもキュー自体は止めず、次の呼び出しを継続させる。
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};
