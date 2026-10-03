/**
 * タイムラインの「秒⇔ピクセル」変換とズーム範囲。timelineUtils.ts側のクランプ処理は
 * 一切秒単位のままにし、ピクセル変換はこのファイルとタイムライン描画コンポーネントの
 * 境界だけで行う(ズーム操作がクリップの重なり判定ロジックに混ざらないようにするため)。
 */

// 長い動画でも最初は全体を画面幅に収めたいため、1秒あたり1pxまで縮められるようにする。
export const MIN_PIXELS_PER_SECOND = 1;
export const MAX_PIXELS_PER_SECOND = 320;
export const DEFAULT_PIXELS_PER_SECOND = 56;

export const clampPixelsPerSecond = (value: number): number =>
  Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, value));

/**
 * タイムラインの見える幅(トラック名の列を除く)に、動画全体がちょうど収まる倍率。
 * スマホで最初から全体を見渡せるようにするための初期値で、拡大は利用者に任せる。
 */
export const fitPixelsPerSecond = (visibleWidthPx: number, totalDurationSeconds: number): number => {
  if (visibleWidthPx <= 0 || totalDurationSeconds <= 0) return DEFAULT_PIXELS_PER_SECOND;
  return clampPixelsPerSecond(visibleWidthPx / totalDurationSeconds);
};

/** 2本指の間隔の変化に合わせた倍率(つまみ始めた時の間隔に対する比率で拡大縮小する)。 */
export const pinchPixelsPerSecond = (
  startPixelsPerSecond: number,
  startDistancePx: number,
  currentDistancePx: number
): number => {
  if (startDistancePx <= 0 || currentDistancePx <= 0) return clampPixelsPerSecond(startPixelsPerSecond);
  return clampPixelsPerSecond(startPixelsPerSecond * (currentDistancePx / startDistancePx));
};

export const secondsToPixels = (seconds: number, pixelsPerSecond: number): number =>
  seconds * pixelsPerSecond;

export const pixelsToSeconds = (pixels: number, pixelsPerSecond: number): number =>
  pixels / pixelsPerSecond;

/** ルーラーの目盛り間隔(秒)。ズームレベルに応じて、詰まりすぎない間隔を選ぶ。 */
export const pickRulerStepSeconds = (pixelsPerSecond: number): number => {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const minPixelsBetweenTicks = 64;
  for (const step of steps) {
    if (step * pixelsPerSecond >= minPixelsBetweenTicks) return step;
  }
  return steps[steps.length - 1];
};

/** タイムコード表示(mm:ss.f、1桁の10分の1秒まで)。 */
export const formatTimecode = (totalSeconds: number): string => {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  const tenths = Math.floor((clamped * 10) % 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
};
