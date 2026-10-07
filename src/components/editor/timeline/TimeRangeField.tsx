"use client";

import { fromOverlayTiming, toOverlayTiming } from "./timeRange";

type Props = {
  startOffsetSeconds: number;
  durationInSeconds?: number;
  /** 選べる範囲の長さ(クリップ内の文字ならクリップの長さ、動画全体の文字なら動画の長さ)。 */
  rangeSeconds: number;
  /** 範囲の説明(「クリップの先頭から」「動画の先頭から」)。 */
  baseLabel: string;
  onChange: (timing: { startOffsetSeconds: number; durationInSeconds: number | undefined }) => void;
  /** つまみ・入力欄を動かした時、その時刻(範囲の先頭からの秒数)を動画で見せる。 */
  onPreview?: (offsetSeconds: number) => void;
};

/**
 * 強調テキスト・画像の「出現開始〜出現終了」の指定欄。つまみが2つある範囲スライダーと数値入力欄を
 * 連動させ、どちらを動かしても動画をその時刻へ移動して確かめられるようにする。
 * 出現終了を右端まで動かすと「最後まで」(表示秒数なし)になる。
 */
export const TimeRangeField: React.FC<Props> = ({
  startOffsetSeconds,
  durationInSeconds,
  rangeSeconds,
  baseLabel,
  onChange,
  onPreview,
}) => {
  const range = Math.max(rangeSeconds, 0.2);
  const { start, end } = fromOverlayTiming({ startOffsetSeconds, durationInSeconds }, range);
  const isUntilEnd = durationInSeconds === undefined;

  const update = (nextStart: number, nextEnd: number, previewAt: number) => {
    onChange(toOverlayTiming(nextStart, nextEnd, range));
    onPreview?.(Math.min(Math.max(previewAt, 0), range));
  };

  return (
    <div className="editor-field">
      <span>表示する時間({baseLabel})</span>
      <div className="time-range" style={{ "--range-start": `${(start / range) * 100}%`, "--range-end": `${(end / range) * 100}%` } as React.CSSProperties}>
        <div className="time-range-track" aria-hidden="true" />
        <input
          type="range"
          aria-label="出現開始"
          min={0}
          max={range}
          step={0.1}
          value={start}
          onChange={(e) => update(Number(e.target.value), end, Number(e.target.value))}
        />
        <input
          type="range"
          aria-label="出現終了"
          min={0}
          max={range}
          step={0.1}
          value={end}
          onChange={(e) => update(start, Number(e.target.value), Number(e.target.value))}
        />
      </div>
      <div className="editor-field-row">
        <label className="editor-field">
          <span>出現開始(秒)</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={range}
            value={Math.round(start * 10) / 10}
            onChange={(e) => update(Number(e.target.value), end, Number(e.target.value))}
          />
        </label>
        <label className="editor-field">
          <span>出現終了(秒)</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={range}
            value={isUntilEnd ? "" : Math.round(end * 10) / 10}
            placeholder="最後まで"
            onChange={(e) =>
              e.target.value === ""
                ? update(start, range, range)
                : update(start, Number(e.target.value), Number(e.target.value))
            }
          />
        </label>
      </div>
    </div>
  );
};
