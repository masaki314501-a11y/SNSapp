"use client";

import { CAPTION_ANIMATION_OPTIONS, type CaptionAnimation, type ImageOverlay } from "@video/shared/schema";
import { resolveClipSrc } from "@video/shared/resolveSrc";
import { ImageIcon, TrashIcon } from "@/components/icons";
import { Collapsible } from "../SettingsSection";
import { TimeRangeField } from "./TimeRangeField";

type Props = {
  image: ImageOverlay;
  /** 表示タイミングの基準の説明(「クリップの先頭から」「動画の先頭から」)。 */
  timeBaseLabel: string;
  /** 表示時間を選べる範囲(クリップ内ならクリップの長さ、動画全体なら動画の長さ)。 */
  rangeSeconds: number;
  /** 何枚目かの見出し(畳んだ時に出す)。 */
  label: string;
  onChange: (patch: Partial<ImageOverlay>) => void;
  onRemove: () => void;
  onPreview?: (offsetSeconds: number) => void;
  defaultOpen?: boolean;
};

/**
 * 差し込んだ画像1枚ぶんの編集欄。位置・大きさ・傾き・角の丸み・表示タイミング・出現演出を直せる。
 * 強調テキストと同じく、普段は畳んでおき押すと開く。
 */
export const ImageOverlayFields: React.FC<Props> = ({
  image,
  timeBaseLabel,
  rangeSeconds,
  label,
  onChange,
  onRemove,
  onPreview,
  defaultOpen,
}) => (
  <Collapsible summary={label} icon={<ImageIcon size={16} />} defaultOpen={defaultOpen}>
    {/* eslint-disable-next-line @next/next/no-img-element -- アップロード済み画像の小さなサムネイル */}
    <img src={resolveClipSrc(image.src)} alt="追加した画像" className="max-h-20 self-start rounded" />
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
    <TimeRangeField
      startOffsetSeconds={image.startOffsetSeconds}
      durationInSeconds={image.durationInSeconds}
      rangeSeconds={rangeSeconds}
      baseLabel={timeBaseLabel}
      onChange={(timing) => onChange(timing)}
      onPreview={onPreview}
    />
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
      <TrashIcon size={14} />
      この画像を削除
    </button>
  </Collapsible>
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
