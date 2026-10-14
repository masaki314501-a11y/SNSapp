"use client";

import { useState } from "react";
import { StyledText } from "@video/shared/StyledText";
import { TEXT_STYLE_PRESETS, findTextStylePreset } from "@video/shared/textStylePresets";

/**
 * 字幕のおすすめの文字スタイル。字幕は数秒ずつ次々に出るので、グラデーションや帯の無い、単色の文字+はっきりした縁取りで
 * 読みやすい物を、色の違いがわかるように選んだ(白+黒縁、白+色縁、黄色+色縁、明朝など)。
 */
export const RECOMMENDED_CAPTION_STYLE_IDS = [
  "creative-078",
  "creative-077",
  "creative-076",
  "creative-074",
  "creative-072",
  "creative-088",
  "creative-089",
  "creative-073",
  "creative-075",
  "creative-090",
  "creative-034",
  "creative-036",
  "creative-038",
  "creative-082",
  "creative-086",
  "creative-111",
];

type Props = {
  /** 欄の名前。 */
  label?: string;
  /** 先に出すおすすめのスタイル。指定した時は、まずこれだけを並べ、「すべて見る」で全部を出す(初めての人が170個から選ばずに済むように)。 */
  recommendedIds?: string[];
  /** スタイル無しの時のボタンの文言。 */
  emptyLabel?: string;
  value: string | undefined;
  onChange: (textStyleId: string | undefined) => void;
};

/** 見本の文字の大きさ。小さくても縁取りや光の違いがわかる大きさにする。 */
const SAMPLE_FONT_SIZE = 22;
/** 見本の後ろの色。白い文字も黒い文字も見えるよう、中くらいの灰色にする。 */
const SAMPLE_BACKGROUND = "#8a9aa8";

/**
 * 文字のスタイル(Premiereのテキストスタイルから作った170種類)を、見本を見ながら選ぶ欄。
 * 一覧は開いた時だけ描く(170個の見本を常に描くと編集画面が重くなるため)。
 */
export const TextStylePicker: React.FC<Props> = ({
  label = "スタイル",
  recommendedIds,
  emptyLabel = "なし(色を自分で選ぶ)",
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(!recommendedIds);
  const shown = showAll
    ? TEXT_STYLE_PRESETS
    : TEXT_STYLE_PRESETS.filter((preset) => recommendedIds?.includes(preset.id));
  const current = findTextStylePreset(value);

  return (
    <div className="editor-field">
      <span>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="editor-toolbar-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ background: current ? SAMPLE_BACKGROUND : undefined, minHeight: 40 }}
        >
          {current ? (
            <StyledText preset={current} fontSizePx={SAMPLE_FONT_SIZE} lines={["テキスト"]} />
          ) : (
            emptyLabel
          )}
        </button>
        {current ? (
          <button type="button" className="editor-toolbar-btn" onClick={() => onChange(undefined)}>
            外す
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          role="listbox"
          aria-label="文字のスタイル"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 6,
            maxHeight: 360,
            overflowY: "auto",
            padding: 6,
            borderRadius: 8,
            background: SAMPLE_BACKGROUND,
          }}
        >
          {shown.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={preset.id === value}
              aria-label={`スタイル${TEXT_STYLE_PRESETS.indexOf(preset) + 1}`}
              onClick={() => {
                onChange(preset.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: 56,
                borderRadius: 6,
                border: preset.id === value ? "2px solid #fff" : "1px solid rgba(255,255,255,0.25)",
                background: "transparent",
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              <StyledText preset={preset} fontSizePx={SAMPLE_FONT_SIZE} lines={["テキスト"]} />
            </button>
          ))}
          {showAll ? null : (
            <button
              type="button"
              className="editor-toolbar-btn"
              style={{ gridColumn: "1 / -1" }}
              onClick={() => setShowAll(true)}
            >
              すべて見る({TEXT_STYLE_PRESETS.length}種類)
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};
