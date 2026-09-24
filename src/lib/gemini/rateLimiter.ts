// Gemini APIのレート制限はモデルごとにかかるため、テキスト系(テロップ生成・文字起こし・
// 自動編集・スタイル抽出)とTTS(AIナレーション)で別々の列に分ける。各列の中では
// サーバープロセス全体で1件ずつ直列実行し、呼び出し間に最低間隔を空けてレート制限エラーを避ける。
// 列を分けておかないと、TTSの一括生成で詰まっている間にテキスト系の呼び出しまで待たされる。
export type GeminiRateLimitLane = "text" | "tts";

// 課金(Tier 1)に切り替えた後はテキスト系のRPM上限に大きく余裕があるため、間隔は短めでよい。
// 無料枠に戻す場合は GEMINI_MIN_INTERVAL_MS=6500 程度に戻すこと
// (4秒間隔=最大15RPMでも無料枠では攻めすぎだった)。
const TEXT_MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS) || 1_000;
// プレビュー版のTTSモデルは有料枠でもRPMが低め(1分あたり10件前後)に抑えられているため、
// 「全クリップに一括生成」のようなバーストで429を踏まないよう無料枠時代と同じ間隔を維持する。
const TTS_MIN_INTERVAL_MS = Number(process.env.GEMINI_TTS_MIN_INTERVAL_MS) || 6_500;

const createLane = (minIntervalMs: number) => {
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

const lanes = {
  text: createLane(TEXT_MIN_INTERVAL_MS),
  tts: createLane(TTS_MIN_INTERVAL_MS),
};

export const runWithGeminiRateLimit = <T>(
  fn: () => Promise<T>,
  lane: GeminiRateLimitLane = "text"
): Promise<T> => lanes[lane](fn);
