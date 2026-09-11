"use client";

import type { ProjectBgm } from "@/lib/videoProject";
import type { AudioSelection } from "./TimelineRoot";
import type { AudioPreset } from "../audioPresets";

type Props = {
  audioSelection: AudioSelection;
  bgm: ProjectBgm | null;
  bgmUploading: boolean;
  bgmPresets: AudioPreset[];
  onSetBgmField: (patch: Partial<Pick<ProjectBgm, "volume" | "fadeInSeconds" | "fadeOutSeconds">>) => void;
  onRemoveBgm: () => void;
  onSetBgmFile: (file: File | null) => void;
  onSetBgmPreset: (preset: AudioPreset) => void;
};

/** 「BGM」タブの右側パネル。BGMの追加(プリセット/アップロード)と、設定中BGMのプロパティ編集。 */
export const BgmInspectorPanel: React.FC<Props> = ({
  audioSelection,
  bgm,
  bgmUploading,
  bgmPresets,
  onSetBgmField,
  onRemoveBgm,
  onSetBgmFile,
  onSetBgmPreset,
}) => {
  const showBgmFields = audioSelection?.kind === "bgm" && bgm;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {showBgmFields && bgm ? (
          <div className="editor-inspector-fields">
            <h3>BGM: {bgm.label}</h3>
            <label className="editor-field">
              <span>音量 {Math.round(bgm.volume * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bgm.volume}
                onChange={(e) => onSetBgmField({ volume: Number(e.target.value) })}
              />
            </label>
            <div className="editor-field-row">
              <label className="editor-field">
                <span>フェードイン(秒)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={5}
                  value={Math.round(bgm.fadeInSeconds * 10) / 10}
                  onChange={(e) => onSetBgmField({ fadeInSeconds: Number(e.target.value) })}
                />
              </label>
              <label className="editor-field">
                <span>フェードアウト(秒)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={5}
                  value={Math.round(bgm.fadeOutSeconds * 10) / 10}
                  onChange={(e) => onSetBgmField({ fadeOutSeconds: Number(e.target.value) })}
                />
              </label>
            </div>
            <button type="button" className="editor-toolbar-btn danger" onClick={onRemoveBgm}>
              削除
            </button>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>{bgm ? "下のBGMブロックを選択すると、ここでプロパティを編集できます" : "BGMを追加すると、ここで音量やフェードを編集できます"}</p>
          </div>
        )}
      </div>

      <div className="editor-inspector-footer">
        {bgmPresets.length > 0 ? (
          <select
            className="editor-toolbar-btn"
            value=""
            onChange={(e) => {
              const preset = bgmPresets.find((p) => p.id === e.target.value);
              if (preset) onSetBgmPreset(preset);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              + BGM(無料素材)
            </option>
            {bgmPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        ) : null}
        <label className="editor-toolbar-btn cursor-pointer">
          {bgmUploading ? "アップロード中..." : bgm ? "BGMを差し替え" : "+ BGMをアップロード"}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={bgmUploading}
            onChange={(e) => {
              onSetBgmFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
};
