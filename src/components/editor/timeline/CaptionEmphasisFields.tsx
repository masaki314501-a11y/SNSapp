"use client";

import { CAPTION_FONT_FAMILY_OPTIONS, type CaptionEmphasis, type CaptionFontFamily } from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";
import { SFX_PRESETS } from "../audioPresets";
import { TextStylePicker } from "./TextStylePicker";

/** 強調をONにした時の初期値。白い帯に黒い文字(シェイプテロップ)。 */
export const DEFAULT_EMPHASIS: CaptionEmphasis = { band: true, bandColor: "#FFFFFF", textColor: "#111111" };

type StyleProps = {
  emphasis: CaptionEmphasis;
  sfxPresetId: string | undefined;
  onChange: (patch: { emphasis?: CaptionEmphasis; sfxPresetId?: string | undefined }) => void;
};

/**
 * 強調した字幕の見た目(帯・色・書体・文字スタイル)と効果音を選ぶ欄。強調を選ぶ画面(全部の強調にまとめて使う)と、
 * 編集画面の字幕タブ(クリップごと)の両方で使う。選んだ内容はAIを使わず、決まった形でそのまま描く。
 */
export const EmphasisStyleFields: React.FC<StyleProps> = ({ emphasis, sfxPresetId, onChange }) => {
  const update = (patch: Partial<CaptionEmphasis>) => onChange({ emphasis: { ...emphasis, ...patch } });
  return (
    <div className="flex flex-col gap-2">
      <div className="color-options">
        <div className="color-option">
          <label className="color-option-toggle">
            <input type="checkbox" checked={emphasis.band} onChange={(e) => update({ band: e.target.checked })} />
            帯を敷く(シェイプテロップ)
          </label>
          <input
            type="color"
            aria-label="帯の色"
            value={emphasis.bandColor ?? "#FFFFFF"}
            disabled={!emphasis.band}
            onChange={(e) => update({ bandColor: e.target.value })}
          />
        </div>
        <label className="color-option">
          <span>文字の色</span>
          <input
            type="color"
            value={emphasis.textColor ?? (emphasis.band ? "#111111" : "#FFFFFF")}
            onChange={(e) => update({ textColor: e.target.value })}
          />
        </label>
      </div>
      <label className="editor-field">
        <span>書体</span>
        <select
          value={emphasis.fontFamily ?? ""}
          onChange={(e) => update({ fontFamily: (e.target.value || undefined) as CaptionFontFamily | undefined })}
        >
          <option value="">ふつうの字幕と同じ</option>
          {CAPTION_FONT_FAMILY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {/* 帯を敷く時は帯の見た目で描くので、文字スタイルは帯なしの時だけ選べる */}
      {emphasis.band ? null : (
        <TextStylePicker label="文字スタイル" value={emphasis.textStyleId} onChange={(textStyleId) => update({ textStyleId })} />
      )}
      <label className="editor-field">
        <span>効果音(字幕が出る時に鳴らす)</span>
        <select value={sfxPresetId ?? ""} onChange={(e) => onChange({ sfxPresetId: e.target.value || undefined })}>
          <option value="">なし</option>
          {SFX_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
};

type Props = {
  segment: ProjectSegment;
  onChange: (patch: Partial<Pick<ProjectSegment, "captionEmphasis" | "emphasisSfxPresetId">>) => void;
};

/** 選んだクリップの字幕を強調する欄(編集画面の字幕タブ)。 */
export const CaptionEmphasisFields: React.FC<Props> = ({ segment, onChange }) => {
  const emphasis = segment.captionEmphasis;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={emphasis !== undefined}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { captionEmphasis: DEFAULT_EMPHASIS }
                : { captionEmphasis: undefined, emphasisSfxPresetId: undefined }
            )
          }
        />
        このクリップの字幕を強調する
      </label>
      {emphasis ? (
        <EmphasisStyleFields
          emphasis={emphasis}
          sfxPresetId={segment.emphasisSfxPresetId}
          onChange={(patch) =>
            onChange({
              ...(patch.emphasis ? { captionEmphasis: patch.emphasis } : {}),
              ...("sfxPresetId" in patch ? { emphasisSfxPresetId: patch.sfxPresetId } : {}),
            })
          }
        />
      ) : null}
    </div>
  );
};

type KeywordProps = {
  keywords: { word: string; color: string }[];
  onChange: (keywords: { word: string; color: string }[]) => void;
};

/** 重大ワードの初期の色。 */
const DEFAULT_KEYWORD_COLOR = "#FF2D2D";
/** 重大ワードの数の上限。描画側のスキーマ(themeSchemaのkeywordHighlights)と合わせる。 */
const MAX_KEYWORDS = 30;

/** 重大ワードの欄。ここに入れた言葉は、全クリップの字幕で指定の色・少し大きい文字になる。 */
export const KeywordHighlightFields: React.FC<KeywordProps> = ({ keywords, onChange }) => (
  <div className="flex flex-col gap-2">
    {keywords.map((keyword, index) => (
      <div key={index} className="flex items-center gap-2">
        <input
          type="text"
          value={keyword.word}
          placeholder="例: 抜歯"
          aria-label={`重大ワード${index + 1}`}
          onChange={(e) => onChange(keywords.map((k, i) => (i === index ? { ...k, word: e.target.value } : k)))}
          className="field-input min-w-0 flex-1 text-sm"
        />
        <input
          type="color"
          aria-label={`重大ワード${index + 1}の色`}
          value={keyword.color}
          onChange={(e) => onChange(keywords.map((k, i) => (i === index ? { ...k, color: e.target.value } : k)))}
        />
        <button
          type="button"
          className="editor-toolbar-btn"
          aria-label={`重大ワード${index + 1}を消す`}
          onClick={() => onChange(keywords.filter((_, i) => i !== index))}
        >
          ✕
        </button>
      </div>
    ))}
    {keywords.length < MAX_KEYWORDS ? (
      <button
        type="button"
        className="editor-toolbar-btn self-start"
        onClick={() => onChange([...keywords, { word: "", color: keywords.at(-1)?.color ?? DEFAULT_KEYWORD_COLOR }])}
      >
        重大ワードを足す
      </button>
    ) : null}
  </div>
);
