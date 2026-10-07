/**
 * 強調テキスト・画像の「出現開始〜出現終了」と、保存形式(開始秒+表示秒数、表示秒数なし=最後まで)の
 * 相互変換。範囲スライダーと数値入力欄の両方がこの変換を通すことで、どちらを動かしても同じ値になる。
 */

/** 出現から消えるまでの最短の長さ(これより短いと見えないため)。 */
export const MIN_VISIBLE_SECONDS = 0.2;

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

type OverlayTiming = { startOffsetSeconds: number; durationInSeconds?: number };

/** 保存されている開始秒・表示秒数を、範囲(0〜rangeSeconds)上の出現開始・出現終了にする。 */
export const fromOverlayTiming = (
  timing: OverlayTiming,
  rangeSeconds: number
): { start: number; end: number } => {
  const start = clamp(timing.startOffsetSeconds, 0, Math.max(0, rangeSeconds - MIN_VISIBLE_SECONDS));
  const end =
    timing.durationInSeconds === undefined ? rangeSeconds : Math.min(rangeSeconds, start + timing.durationInSeconds);
  return { start, end };
};

/**
 * 出現開始・出現終了を、保存形式に戻す。終了が範囲の終わりなら「最後まで」(表示秒数なし)にする。
 * 終了が開始より前に来ないよう、最短の表示秒数を確保する。
 */
export const toOverlayTiming = (
  start: number,
  end: number,
  rangeSeconds: number
): { startOffsetSeconds: number; durationInSeconds: number | undefined } => {
  const startOffsetSeconds = round1(clamp(start, 0, Math.max(0, rangeSeconds - MIN_VISIBLE_SECONDS)));
  const clampedEnd = clamp(end, startOffsetSeconds + MIN_VISIBLE_SECONDS, rangeSeconds);
  const reachesEnd = clampedEnd >= rangeSeconds - 0.05;
  return {
    startOffsetSeconds,
    durationInSeconds: reachesEnd ? undefined : round1(clampedEnd - startOffsetSeconds),
  };
};
