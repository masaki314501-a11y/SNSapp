/**
 * タイムラインの「秒⇔ピクセル」変換とズーム範囲。timelineUtils.ts側のクランプ処理は
 * 一切秒単位のままにし、ピクセル変換はこのファイルとタイムライン描画コンポーネントの
 * 境界だけで行う(ズーム操作がクリップの重なり判定ロジックに混ざらないようにするため)。
 */

export const MIN_PIXELS_PER_SECOND = 12;
export const MAX_PIXELS_PER_SECOND = 320;
export const DEFAULT_PIXELS_PER_SECOND = 56;

export const clampPixelsPerSecond = (value: number): number =>
  Math.min(MAX_PIXELS_PER_SECOND, Math.max(MIN_PIXELS_PER_SECOND, value));

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
