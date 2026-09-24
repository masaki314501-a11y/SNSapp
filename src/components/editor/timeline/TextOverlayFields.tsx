"use client";

import { CAPTION_ANIMATION_OPTIONS, type CaptionAnimation, type TextOverlay } from "@video/shared/schema";

type Props = {
  overlay: TextOverlay;
  /** 表示タイミングの基準の説明(「クリップ先頭から」「動画の先頭から」)。 */
  timeBaseLabel: string;
  onChange: (patch: Partial<TextOverlay>) => void;
  onRemove: () => void;
};

/**
 * 自動編集(Gemini)が決めた強調テキスト1個ぶんの編集欄。文言・位置・大きさ・色・縁取り・帯・傾き・
 * 表示タイミング・出現演出まで、自動編集が決めた項目はすべてここで直せるようにする。
 * クリップ内の強調テキストと、動画全体に出し続ける文字(globalOverlays)の両方で使う。
 */
export const TextOverlayFields: React.FC<Props> = ({ overlay, timeBaseLabel, onChange, onRemove }) => (
  <div className="flex flex-col gap-2 rounded-lg p-2" style={{ border: "1px solid var(--border)" }}>
    <label className="editor-field">
      <span>文言</span>
      <input type="text" value={overlay.text} onChange={(e) => onChange({ text: e.target.value })} />
    </label>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>横位置 {Math.round(overlay.xPercent)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={overlay.xPercent}
          onChange={(e) => onChange({ xPercent: Number(e.target.value) })}
        />
      </label>
      <label className="editor-field">
        <span>縦位置 {Math.round(overlay.yPercent)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={overlay.yPercent}
          onChange={(e) => onChange({ yPercent: Number(e.target.value) })}
        />
      </label>
    </div>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>大きさ {Math.round(overlay.fontSizePx)}px</span>
        <input
          type="range"
          min={20}
          max={220}
          value={overlay.fontSizePx}
          onChange={(e) => onChange({ fontSizePx: Number(e.target.value) })}
        />
      </label>
      <label className="editor-field">
        <span>傾き {Math.round(overlay.rotationDeg)}°</span>
        <input
          type="range"
          min={-30}
          max={30}
          value={overlay.rotationDeg}
          onChange={(e) => onChange({ rotationDeg: Number(e.target.value) })}
        />
      </label>
    </div>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>文字色</span>
        <input type="color" value={overlay.color} onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      <label className="editor-field">
        <span>
          <input
            type="checkbox"
            checked={overlay.strokeColor !== undefined}
            onChange={(e) => onChange({ strokeColor: e.target.checked ? "#000000" : undefined })}
          />{" "}
          縁取り
        </span>
        <input
          type="color"
          value={overlay.strokeColor ?? "#000000"}
          disabled={overlay.strokeColor === undefined}
          onChange={(e) => onChange({ strokeColor: e.target.value })}
        />
      </label>
      <label className="editor-field">
        <span>
          <input
            type="checkbox"
            checked={overlay.backgroundColor !== undefined}
            onChange={(e) => onChange({ backgroundColor: e.target.checked ? "#000000" : undefined })}
          />{" "}
          帯
        </span>
        <input
          type="color"
          value={overlay.backgroundColor ?? "#000000"}
          disabled={overlay.backgroundColor === undefined}
          onChange={(e) => onChange({ backgroundColor: e.target.value })}
        />
      </label>
    </div>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>出す時刻(秒・{timeBaseLabel})</span>
        <input
          type="number"
          step={0.1}
          min={0}
          value={Math.round(overlay.startOffsetSeconds * 10) / 10}
          onChange={(e) => onChange({ startOffsetSeconds: Math.max(0, Number(e.target.value)) })}
        />
      </label>
      <label className="editor-field">
        <span>表示秒数(空=最後まで)</span>
        <input
          type="number"
          step={0.1}
          min={0.2}
          value={overlay.durationInSeconds === undefined ? "" : Math.round(overlay.durationInSeconds * 10) / 10}
          placeholder="最後まで"
          onChange={(e) =>
            onChange({ durationInSeconds: e.target.value === "" ? undefined : Math.max(0.2, Number(e.target.value)) })
          }
        />
      </label>
    </div>
    <label className="editor-field">
      <span>出現演出</span>
      <select
        value={overlay.animation}
        onChange={(e) => onChange({ animation: e.target.value as CaptionAnimation })}
      >
        {CAPTION_ANIMATION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <button type="button" className="editor-toolbar-btn danger self-start" onClick={onRemove}>
      この文字を消す
    </button>
  </div>
);

/** 「文字を追加」で作る強調テキストの初期値。画面中央上寄りに白文字+黒縁で出す。 */
export const createDefaultTextOverlay = (): TextOverlay => ({
  text: "テキスト",
  startOffsetSeconds: 0,
  xPercent: 50,
  yPercent: 35,
  fontSizePx: 90,
  color: "#FFFFFF",
  strokeColor: "#000000",
  rotationDeg: 0,
  animation: "pop",
});
