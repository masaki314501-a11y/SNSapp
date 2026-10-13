"use client";

import { CAPTION_FONT_FAMILY_OPTIONS, type CaptionEmphasis, type CaptionFontFamily } from "@video/shared/schema";
import type { ProjectSegment } from "@/lib/videoProject";
import { SFX_PRESETS } from "../audioPresets";
import { TextStylePicker } from "./TextStylePicker";

/** 強調をONにした時の初期値。白い帯に黒い文字(シェイプテロップ)。 */
const DEFAULT_EMPHASIS: CaptionEmphasis = { band: true, bandColor: "#FFFFFF", textColor: "#111111" };

type Props = {
  segment: ProjectSegment;
  onChange: (patch: Partial<Pick<ProjectSegment, "captionEmphasis" | "emphasisSfxPresetId">>) => void;
};

/**
 * 選んだクリップの字幕を強調する欄。強調はAIに任せず本人が選ぶ(自動編集の字幕は、強調なし・書体は全体で1つ)。
 * 帯を敷くシェイプテロップにするか、書体・文字の色・文字スタイル、鳴らす効果音を選ぶ。選んだ内容は決まった形でそのまま描く。
 */
export const CaptionEmphasisFields: React.FC<Props> = ({ segment, onChange }) => {
  const emphasis = segment.captionEmphasis;
  const update = (patch: Partial<CaptionEmphasis>) => onChange({ captionEmphasis: { ...(emphasis ?? DEFAULT_EMPHASIS), ...patch } });

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
        <>
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
              <option value="">全体の字幕と同じ</option>
              {CAPTION_FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {/* 帯を敷く時は帯の見た目で描くので、文字スタイルは帯なしの時だけ選べる */}
          {emphasis.band ? null : (
            <TextStylePicker
              label="文字スタイル"
              value={emphasis.textStyleId}
              onChange={(textStyleId) => update({ textStyleId })}
            />
          )}
          <label className="editor-field">
            <span>効果音(クリップの頭で鳴らす)</span>
            <select
              value={segment.emphasisSfxPresetId ?? ""}
              onChange={(e) => onChange({ emphasisSfxPresetId: e.target.value || undefined })}
            >
              <option value="">なし</option>
              {SFX_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </>
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
