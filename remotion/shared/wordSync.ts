import { phraseEnds } from "./textWrap";

/**
 * 字幕を、話している言葉に合わせて見せる仕組み。
 * - highlight: 字幕の全文を出したまま、今話している言葉のかたまりだけ色を変える
 * - reveal: 話した所まで言葉のかたまりを順に出していく
 * 言葉ごとの正確な時刻は取らず、音から調べた「話している区間」(speechActivity.ts)の長さを、文字数の割合で
 * 言葉のかたまりに割り振る。日本語は話す速さがほぼ一定なので、これで十分に合う(言葉ごとの時刻をAIに出させるより安く、ずれにくい)。
 */
export type WordSyncMode = "none" | "highlight" | "reveal";

export const WORD_SYNC_OPTIONS: { value: WordSyncMode; label: string }[] = [
  { value: "highlight", label: "今話している言葉を光らせる" },
  { value: "reveal", label: "話した言葉から順に出す" },
  { value: "none", label: "合わせない(全文をそのまま出す)" },
];

/** 話している区間が分からない時は、クリップのこの割合までの間に話しているとみなす。 */
const FALLBACK_SPEECH_RATIO = 0.85;

/**
 * 今(クリップの先頭からの秒数)話している言葉のかたまりの、文字の範囲[start, end)。まだ話し始めていなければnull。
 * spansはクリップの先頭からの秒数の「話している区間」。
 */
export const currentPhraseRange = (
  text: string,
  spans: [number, number][],
  clipDurationSeconds: number,
  timeSeconds: number
): { start: number; end: number } | null => {
  const total = text.length;
  if (total === 0) return null;
  const clipped = spans
    .map(([a, b]): [number, number] => [Math.max(0, a), Math.min(clipDurationSeconds, b)])
    .filter(([a, b]) => b - a > 0.02);
  const active: [number, number][] = clipped.length > 0 ? clipped : [[0, clipDurationSeconds * FALLBACK_SPEECH_RATIO]];
  const activeTotal = active.reduce((sum, [a, b]) => sum + (b - a), 0);
  // 話している時間をつないだ軸の上の位置を、クリップの秒数に直す
  const toClipTime = (activeOffset: number): number => {
    let rest = activeOffset;
    for (const [a, b] of active) {
      if (rest <= b - a) return a + rest;
      rest -= b - a;
    }
    return active[active.length - 1][1];
  };
  const ends = phraseEnds(text);
  let start = 0;
  let current: { start: number; end: number } | null = null;
  for (const end of ends) {
    if (toClipTime((activeTotal * start) / total) > timeSeconds) break;
    current = { start, end };
    start = end;
  }
  return current;
};
