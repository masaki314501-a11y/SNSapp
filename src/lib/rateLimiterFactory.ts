// 無料枠のAPIはRPM(1分あたりのリクエスト数)制限が厳しいため、同じレーンを共有する
// 呼び出し元同士は1件ずつ直列実行し、呼び出し間に最低間隔を空けることでレート制限エラーを
// 避ける。プロバイダー・モデルによって無料枠のRPM上限が大きく異なるため、レーン(キュー)を
// 分けて別々の間隔で制御できるようにしている(Gemini/Groqで共有する土台)。

export const createRateLimiterLane = (minIntervalMs: number) => {
  let queue: Promise<unknown> = Promise.resolve();
  let lastCallFinishedAt = 0;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const waitMs = lastCallFinishedAt + minIntervalMs - Date.now();
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
};
