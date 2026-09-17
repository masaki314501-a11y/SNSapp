/**
 * タイムライン上のクリップ(=元動画から切り出す区間)の位置・尺を編集する際の
 * 共通ロジック(隣接クリップとの重なり防止・動画範囲内へのクランプ)。
 */

// キャプションとして読める尺の目安。トリミング(カット)の粒度もこれに従う。
export const MIN_SEGMENT_DURATION_IN_SECONDS = 0.5;
export const MAX_SEGMENT_DURATION_IN_SECONDS = 30;

export type TimelineSegment = {
  startFromSeconds: number;
  durationInSeconds: number;
};

/** 浮動小数点誤差を許容した上での、時刻の近似一致判定。 */
const TIME_EPSILON_SECONDS = 0.01;

/**
 * 再生順で隣り合う2クリップ(segments[index]とsegments[index + 1])が、
 * 元動画上でも時刻的に連続しているか(=splitSegmentの逆操作として結合できるか)を判定する。
 * 結合後の尺がMAX_SEGMENT_DURATION_IN_SECONDSを超える場合も不可とする。
 */
export const canMergeWithNext = <T extends TimelineSegment>(
  segments: T[],
  index: number
): boolean => {
  const current = segments[index];
  const next = segments[index + 1];
  if (!current || !next) return false;
  const isContiguous =
    Math.abs(current.startFromSeconds + current.durationInSeconds - next.startFromSeconds) <
    TIME_EPSILON_SECONDS;
  if (!isContiguous) return false;
  return current.durationInSeconds + next.durationInSeconds <= MAX_SEGMENT_DURATION_IN_SECONDS;
};

/**
 * segments[index]とsegments[index + 1]を1つに結合した新しい配列を返す(再生順の位置は
 * segments[index]の位置を引き継ぐ)。呼び出し前に canMergeWithNext で確認すること。
 * captionは前後を空白で連結する(どちらかが空文字なら非空側のみを使う)。
 */
export const mergeWithNext = <T extends TimelineSegment & { caption: string }>(
  segments: T[],
  index: number
): T[] => {
  const current = segments[index];
  const next = segments[index + 1];
  const merged: T = {
    ...current,
    durationInSeconds: current.durationInSeconds + next.durationInSeconds,
    caption: [current.caption, next.caption].filter((text) => text.trim().length > 0).join(" "),
  };
  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
};

/**
 * 再生ヘッドがsegments[index]内の何秒目(クリップ先頭からのオフセット)にあるかを受け取り、
 * そこで分割できるか(分割後の前後どちらの尺もMIN_SEGMENT_DURATION_IN_SECONDS以上になるか)を判定する。
 */
export const canSplitSegment = (
  segment: TimelineSegment,
  offsetInSegmentSeconds: number
): boolean => {
  const firstDuration = offsetInSegmentSeconds;
  const secondDuration = segment.durationInSeconds - offsetInSegmentSeconds;
  return (
    firstDuration >= MIN_SEGMENT_DURATION_IN_SECONDS && secondDuration >= MIN_SEGMENT_DURATION_IN_SECONDS
  );
};

/**
 * segments[index]を、クリップ先頭からoffsetInSegmentSeconds秒の位置で前後2クリップに分割する
 * (mergeWithNextの逆操作)。前半は元のキー・テロップを引き継ぎ、後半は新しいキー(newKey)を持ち、
 * テロップは空にする(mergeWithNextが非空側のみを連結する挙動と対になるようにするため)。
 * 呼び出し前に canSplitSegment で確認すること。
 */
export const splitSegment = <T extends TimelineSegment & { caption: string; key: string }>(
  segments: T[],
  index: number,
  offsetInSegmentSeconds: number,
  newKey: string
): T[] => {
  const seg = segments[index];
  const first: T = { ...seg, durationInSeconds: offsetInSegmentSeconds };
  const second: T = {
    ...seg,
    key: newKey,
    startFromSeconds: seg.startFromSeconds + offsetInSegmentSeconds,
    durationInSeconds: seg.durationInSeconds - offsetInSegmentSeconds,
    caption: "",
  };
  return [...segments.slice(0, index), first, second, ...segments.slice(index + 1)];
};

/**
 * 元動画上の区間[rangeStart, rangeEnd)を、全クリップから取り除く。区間がクリップの
 * 真ん中にかかる場合は前後2つに分かれる(splitSegmentと同じく、後半はテロップを持たない
 * 新しいキーのクリップになる)。取り除いた結果、最小尺を下回った断片は捨てる。
 * ラフカット画面で「元動画のこのあたりは丸ごと要らない」を1操作で行うために使う。
 */
export const subtractSourceRange = <T extends TimelineSegment & { caption: string; key: string }>(
  segments: T[],
  rangeStart: number,
  rangeEnd: number,
  makeKey: () => string
): T[] => {
  const result: T[] = [];
  for (const seg of segments) {
    const segStart = seg.startFromSeconds;
    const segEnd = segStart + seg.durationInSeconds;
    const overlapStart = Math.max(segStart, rangeStart);
    const overlapEnd = Math.min(segEnd, rangeEnd);
    if (overlapEnd - overlapStart <= TIME_EPSILON_SECONDS) {
      result.push(seg);
      continue;
    }
    if (overlapStart - segStart >= MIN_SEGMENT_DURATION_IN_SECONDS) {
      result.push({ ...seg, durationInSeconds: overlapStart - segStart });
    }
    if (segEnd - overlapEnd >= MIN_SEGMENT_DURATION_IN_SECONDS) {
      result.push({
        ...seg,
        key: makeKey(),
        caption: "",
        startFromSeconds: overlapEnd,
        durationInSeconds: segEnd - overlapEnd,
      });
    }
  }
  return result;
};

/**
 * 元動画上の区間[rangeStart, rangeEnd)に重なる部分だけを残す(subtractSourceRangeの逆)。
 * 何テイクも撮った中から「この1テイクだけ使う」を1操作で行うために使う。
 */
export const keepOnlySourceRange = <T extends TimelineSegment>(
  segments: T[],
  rangeStart: number,
  rangeEnd: number
): T[] =>
  segments.reduce<T[]>((acc, seg) => {
    const overlapStart = Math.max(seg.startFromSeconds, rangeStart);
    const overlapEnd = Math.min(seg.startFromSeconds + seg.durationInSeconds, rangeEnd);
    if (overlapEnd - overlapStart >= MIN_SEGMENT_DURATION_IN_SECONDS) {
      acc.push({ ...seg, startFromSeconds: overlapStart, durationInSeconds: overlapEnd - overlapStart });
    }
    return acc;
  }, []);

/**
 * 与えられたクリップ群(元動画上の時刻順にソート済みであること)から、
 * まだどのクリップにも使われていない最大の空き区間を探す。
 * 「+ 字幕を追加」で新規クリップを配置する位置に使う。
 */
export const findLargestGap = (
  segments: TimelineSegment[],
  videoDurationInSeconds: number
): { start: number; size: number } | null => {
  const sorted = [...segments].sort((a, b) => a.startFromSeconds - b.startFromSeconds);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.startFromSeconds > cursor) gaps.push([cursor, seg.startFromSeconds]);
    cursor = Math.max(cursor, seg.startFromSeconds + seg.durationInSeconds);
  }
  if (cursor < videoDurationInSeconds) gaps.push([cursor, videoDurationInSeconds]);
  if (gaps.length === 0) return null;

  const largest = gaps.reduce((best, cur) => (cur[1] - cur[0] > best[1] - best[0] ? cur : best));
  const size = largest[1] - largest[0];
  return size > 0.05 ? { start: largest[0], size } : null;
};

// レンダー時のスキーマ検証(clip.durationInSeconds >= 0.3)を満たすための下限。
// keepRangeの境界でちょうど切り詰められた発話区切りは、これを下回る細切れになりうる。
const MIN_RENDERABLE_DURATION_IN_SECONDS = 0.3;

/**
 * 短すぎるクリップ(keepRangeの境界などで発話区切りが細切れになったもの)を、
 * 同じkeepRange内で隣接するクリップに吸収してテキストを引き継ぐ(mergeWithNextと
 * 同様、空でない側のテキストのみ連結)。吸収先が無い(range内に1件だけ)場合は、
 * range内に収まる範囲で尺そのものを底上げする。
 */
const mergeTooShortSegments = <T extends TimelineSegment & { caption: string }>(
  segments: T[],
  rangeStart: number,
  rangeEnd: number
): T[] => {
  const result = [...segments];
  for (let i = 0; i < result.length; i++) {
    if (result[i].durationInSeconds >= MIN_RENDERABLE_DURATION_IN_SECONDS) continue;
    const tiny = result[i];
    if (result.length === 1) {
      // 浮動小数点の減算誤差でちょうど下限(0.3)を僅かに下回ると再びスキーマ検証に
      // 引っかかるため、下限そのものではなく少し余裕を持たせた尺を目標にする。
      const targetDuration = MIN_RENDERABLE_DURATION_IN_SECONDS + 0.02;
      const extendedEnd = Math.min(rangeEnd, tiny.startFromSeconds + targetDuration);
      const extendedStart = Math.max(rangeStart, extendedEnd - targetDuration);
      result[i] = { ...tiny, startFromSeconds: extendedStart, durationInSeconds: extendedEnd - extendedStart };
      continue;
    }
    const mergeIntoNext = i < result.length - 1;
    const targetIndex = mergeIntoNext ? i + 1 : i - 1;
    const target = result[targetIndex];
    const mergedStart = Math.min(tiny.startFromSeconds, target.startFromSeconds);
    const mergedEnd = Math.max(
      tiny.startFromSeconds + tiny.durationInSeconds,
      target.startFromSeconds + target.durationInSeconds
    );
    const captionParts = mergeIntoNext ? [tiny.caption, target.caption] : [target.caption, tiny.caption];
    const merged: T = {
      ...target,
      startFromSeconds: mergedStart,
      durationInSeconds: mergedEnd - mergedStart,
      caption: captionParts.filter((text) => text.trim().length > 0).join(" "),
    };
    const spliceIndex = Math.min(i, targetIndex);
    result.splice(spliceIndex, 2, merged);
    i = spliceIndex - 1;
  }
  return result;
};

/**
 * 文字起こし結果(動画全体を対象に生成された時系列順のクリップ)を、ラフカット画面で選んだ
 * 「使う範囲(keepRanges、再生順)」だけに絞り込む。範囲境界をまたぐクリップは境界で切り詰め、
 * 各keepRangeの内部では時系列順(=文字起こし結果の並び)を保つ。keepRangesの並び順が
 * そのまま出力の再生順になる。切り詰めで下限(0.3秒)を下回ったクリップは同じrange内の
 * 隣接クリップに吸収する(range境界をまたいで吸収すると、カットで捨てた範囲を
 * 誤って含めてしまうため、吸収はrange内に限定する)。
 */
export const clipTranscribedToKeepRanges = <T extends TimelineSegment & { caption: string }>(
  transcribed: T[],
  keepRanges: TimelineSegment[]
): T[] => {
  const sorted = [...transcribed].sort((a, b) => a.startFromSeconds - b.startFromSeconds);
  const result: T[] = [];
  for (const range of keepRanges) {
    const rangeStart = range.startFromSeconds;
    const rangeEnd = range.startFromSeconds + range.durationInSeconds;
    const withinRange: T[] = [];
    for (const segment of sorted) {
      const segStart = segment.startFromSeconds;
      const segEnd = segment.startFromSeconds + segment.durationInSeconds;
      const overlapStart = Math.max(segStart, rangeStart);
      const overlapEnd = Math.min(segEnd, rangeEnd);
      if (overlapEnd - overlapStart <= TIME_EPSILON_SECONDS) continue;
      withinRange.push({
        ...segment,
        startFromSeconds: overlapStart,
        durationInSeconds: overlapEnd - overlapStart,
      });
    }
    result.push(...mergeTooShortSegments(withinRange, rangeStart, rangeEnd));
  }
  return result;
};

/**
 * クリップ左端をドラッグ(トリムイン)した時の新しいstart/durationを、
 * 「前のクリップの終端」〜「自分の終端 - 最小尺」の範囲にクランプして返す。
 */
export const clampTrimStart = (
  index: number,
  sorted: TimelineSegment[],
  desiredStart: number
): { startFromSeconds: number; durationInSeconds: number } => {
  const seg = sorted[index];
  const prevEnd =
    index > 0 ? sorted[index - 1].startFromSeconds + sorted[index - 1].durationInSeconds : 0;
  const segEnd = seg.startFromSeconds + seg.durationInSeconds;
  const maxStart = segEnd - MIN_SEGMENT_DURATION_IN_SECONDS;
  const clampedStart = Math.min(Math.max(desiredStart, prevEnd), Math.max(prevEnd, maxStart));
  return { startFromSeconds: clampedStart, durationInSeconds: segEnd - clampedStart };
};

/**
 * クリップ右端をドラッグ(トリムアウト)した時の新しいdurationを、
 * 「最小尺」〜「次のクリップの開始(無ければ動画終端)まで」の範囲にクランプして返す。
 */
export const clampTrimEnd = (
  index: number,
  sorted: TimelineSegment[],
  videoDurationInSeconds: number,
  desiredDuration: number
): number => {
  const seg = sorted[index];
  const nextStart =
    index < sorted.length - 1 ? sorted[index + 1].startFromSeconds : videoDurationInSeconds;
  const maxDuration = Math.min(MAX_SEGMENT_DURATION_IN_SECONDS, nextStart - seg.startFromSeconds);
  return Math.min(
    Math.max(desiredDuration, MIN_SEGMENT_DURATION_IN_SECONDS),
    Math.max(MIN_SEGMENT_DURATION_IN_SECONDS, maxDuration)
  );
};

