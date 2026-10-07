/**
 * 待ち時間のある操作(アップロード・AI処理・書き出し等)の「目安の待ち時間」を出す。
 * 最初は動画の長さ・枚数などからの初期値で見積もり、実際にかかった時間をこの端末に記録して
 * 次からはその実績で補正する(サーバーの混み具合や回線の速さは環境ごとに違うため、使うほど正確になる)。
 * 記録はlocalStorageに置くだけなので、使えない環境(プライベートブラウズ等)では初期値のまま動く。
 */
export type WaitTaskId =
  | "video-convert"
  | "video-upload"
  | "file-upload"
  | "extract-style-image"
  | "extract-style-video"
  | "auto-edit"
  | "transcribe"
  | "revise-edit"
  | "narration"
  | "render"
  | "example-breakdown";

/**
 * 初期値は「base秒 + perUnit秒 × 量」。量の単位は操作ごとに違う(コメント参照)。
 * AI処理の値はProモデルでの実測(README参照)をもとにした、やや長めの見積もり。
 */
const DEFAULTS: Record<WaitTaskId, { base: number; perUnit: number }> = {
  // 量=ファイルの大きさ(MB)
  "video-convert": { base: 5, perUnit: 1.5 },
  "video-upload": { base: 2, perUnit: 0.5 },
  "file-upload": { base: 3, perUnit: 0.3 },
  // 量=画像の枚数
  "extract-style-image": { base: 25, perUnit: 5 },
  // 量は使わない(参考動画1本)
  "extract-style-video": { base: 45, perUnit: 0 },
  // 量=使う範囲の合計秒数(53秒の動画で2〜3分の実測)
  "auto-edit": { base: 60, perUnit: 1.8 },
  // 量=動画の秒数
  transcribe: { base: 15, perUnit: 0.6 },
  "revise-edit": { base: 40, perUnit: 0 },
  // 量=作るナレーションの数(TTSは間隔を空けて1つずつ作るため)
  narration: { base: 0, perUnit: 10 },
  // 量=書き出す動画の秒数(ブラウザ内での書き出し)
  render: { base: 15, perUnit: 2 },
  // 学習データの正解動画の書き起こし(Proモデルで素材と正解動画の2本を見る)
  "example-breakdown": { base: 150, perUnit: 0 },
};

const STORAGE_KEY = "sns-app:wait-history:v1";
/** 実績は直近のものだけ使う(サーバーやモデルが変わったら早めに追従させるため)。 */
const MAX_HISTORY = 8;

type History = Partial<Record<WaitTaskId, number[]>>;

const defaultSeconds = (task: WaitTaskId, units: number): number => {
  const { base, perUnit } = DEFAULTS[task];
  return Math.max(1, base + perUnit * Math.max(0, units));
};

const readHistory = (): History => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as History) : {};
  } catch {
    return {};
  }
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** 目安の秒数。過去の実績があれば「実際の時間÷初期値」の中央値で初期値を補正する(1回の外れ値に引っ張られないよう中央値)。 */
export const estimateWaitSeconds = (task: WaitTaskId, units: number): number => {
  const base = defaultSeconds(task, units);
  if (typeof window === "undefined") return base;
  const ratios = readHistory()[task];
  return ratios && ratios.length > 0 ? base * median(ratios) : base;
};

/** 実際にかかった時間を記録する。極端な値(途中で放置された等)は、補正が暴れないよう比率を丸める。 */
export const recordWaitSeconds = (task: WaitTaskId, units: number, actualSeconds: number): void => {
  if (typeof window === "undefined" || actualSeconds <= 0) return;
  try {
    const history = readHistory();
    const ratio = Math.min(Math.max(actualSeconds / defaultSeconds(task, units), 0.2), 5);
    history[task] = [...(history[task] ?? []), ratio].slice(-MAX_HISTORY);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // 保存できなくても目安が初期値のままになるだけなので無視する
  }
};

/** 「約40秒」「約3分」のような、ざっくりした言い方にする(細かい秒数は外れたときに気になるため)。 */
export const formatApproxDuration = (seconds: number): string => {
  if (seconds < 10) return "数秒";
  if (seconds < 60) return `約${Math.ceil(seconds / 10) * 10}秒`;
  return `約${Math.max(1, Math.round(seconds / 60))}分`;
};

/** 経過時間は「1:05」の形で、1秒ずつ進むのが分かるようにする。 */
export const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
