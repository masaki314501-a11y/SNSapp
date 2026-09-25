"use client";

import { CAPTION_ANIMATION_OPTIONS, type CaptionAnimation, type ImageOverlay } from "@video/shared/schema";
import { resolveClipSrc } from "@video/shared/resolveSrc";

type Props = {
  image: ImageOverlay;
  /** 表示タイミングの基準の説明(「クリップ先頭から」「動画の先頭から」)。 */
  timeBaseLabel: string;
  onChange: (patch: Partial<ImageOverlay>) => void;
  onRemove: () => void;
};

/** 差し込んだ画像1枚ぶんの編集欄。位置・大きさ・傾き・角の丸み・表示タイミング・出現演出を直せる。 */
export const ImageOverlayFields: React.FC<Props> = ({ image, timeBaseLabel, onChange, onRemove }) => (
  <div className="flex flex-col gap-2 rounded-lg p-2" style={{ border: "1px solid var(--border)" }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- アップロード済み画像の小さなサムネイル */}
    <img src={resolveClipSrc(image.src)} alt="差し込んだ画像" className="max-h-20 self-start rounded" />
    <div className="editor-field-row">
      <label className="editor-field">
        <span>横位置 {Math.round(image.xPercent)}%</span>
        <input type="range" min={0} max={100} value={image.xPercent} onChange={(e) => onChange({ xPercent: Number(e.target.value) })} />
      </label>
      <label className="editor-field">
        <span>縦位置 {Math.round(image.yPercent)}%</span>
        <input type="range" min={0} max={100} value={image.yPercent} onChange={(e) => onChange({ yPercent: Number(e.target.value) })} />
      </label>
    </div>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>幅 {Math.round(image.widthPercent)}%</span>
        <input type="range" min={5} max={100} value={image.widthPercent} onChange={(e) => onChange({ widthPercent: Number(e.target.value) })} />
      </label>
      <label className="editor-field">
        <span>傾き {Math.round(image.rotationDeg)}°</span>
        <input type="range" min={-45} max={45} value={image.rotationDeg} onChange={(e) => onChange({ rotationDeg: Number(e.target.value) })} />
      </label>
    </div>
    <label className="editor-field">
      <span>角の丸み {Math.round(image.cornerRadiusPx)}px</span>
      <input type="range" min={0} max={200} value={image.cornerRadiusPx} onChange={(e) => onChange({ cornerRadiusPx: Number(e.target.value) })} />
    </label>
    <div className="editor-field-row">
      <label className="editor-field">
        <span>出す時刻(秒・{timeBaseLabel})</span>
        <input
          type="number"
          step={0.1}
          min={0}
          value={Math.round(image.startOffsetSeconds * 10) / 10}
          onChange={(e) => onChange({ startOffsetSeconds: Math.max(0, Number(e.target.value)) })}
        />
      </label>
      <label className="editor-field">
        <span>表示秒数(空=最後まで)</span>
        <input
          type="number"
          step={0.1}
          min={0.2}
          value={image.durationInSeconds === undefined ? "" : Math.round(image.durationInSeconds * 10) / 10}
          placeholder="最後まで"
          onChange={(e) =>
            onChange({ durationInSeconds: e.target.value === "" ? undefined : Math.max(0.2, Number(e.target.value)) })
          }
        />
      </label>
    </div>
    <label className="editor-field">
      <span>出現演出</span>
      <select value={image.animation} onChange={(e) => onChange({ animation: e.target.value as CaptionAnimation })}>
        {CAPTION_ANIMATION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <button type="button" className="editor-toolbar-btn danger self-start" onClick={onRemove}>
      この画像を消す
    </button>
  </div>
);

/** アップロード直後の画像の初期値。画面中央に、画面幅の半分の大きさで出す。 */
export const createDefaultImageOverlay = (src: string): ImageOverlay => ({
  src,
  startOffsetSeconds: 0,
  xPercent: 50,
  yPercent: 50,
  widthPercent: 50,
  rotationDeg: 0,
  cornerRadiusPx: 0,
  animation: "pop",
});
