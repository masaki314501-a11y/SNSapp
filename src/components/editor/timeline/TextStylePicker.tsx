"use client";

import { useState } from "react";
import { StyledText } from "@video/shared/StyledText";
import { TEXT_STYLE_PRESETS, findTextStylePreset } from "@video/shared/textStylePresets";

type Props = {
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
export const TextStylePicker: React.FC<Props> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const current = findTextStylePreset(value);

  return (
    <div className="editor-field">
      <span>スタイル</span>
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
            "なし(色を自分で選ぶ)"
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
          {TEXT_STYLE_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={preset.id === value}
              aria-label={`スタイル${index + 1}`}
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
        </div>
      ) : null}
    </div>
  );
};
