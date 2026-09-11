"use client";

import type { ProjectSfxClip } from "@/lib/videoProject";
import type { AudioSelection } from "./TimelineRoot";
import type { AudioPreset } from "../audioPresets";

type Props = {
  audioSelection: AudioSelection;
  /** SEのみ(AIナレーションを除く)。表示用のトラックも同じ絞り込みをしている。 */
  sfxClips: ProjectSfxClip[];
  /** SE+AIナレーション合計件数(上限判定用。上限は両者で共有のため絞り込み前の件数が必要)。 */
  totalSfxCount: number;
  sfxUploading: boolean;
  maxSfxClips: number;
  sfxPresets: AudioPreset[];
  onUpdateSfx: (key: string, patch: Partial<Pick<ProjectSfxClip, "startFromSeconds" | "volume">>) => void;
  onRemoveSfx: (key: string) => void;
  onAddSfxFile: (file: File | null) => void;
  onAddSfxPreset: (preset: AudioPreset) => void;
};

/** 「SE」タブの右側パネル。効果音の追加(プリセット/アップロード)と、選択中SEのプロパティ編集。 */
export const SfxInspectorPanel: React.FC<Props> = ({
  audioSelection,
  sfxClips,
  totalSfxCount,
  sfxUploading,
  maxSfxClips,
  sfxPresets,
  onUpdateSfx,
  onRemoveSfx,
  onAddSfxFile,
  onAddSfxPreset,
}) => {
  const selectedSfx = audioSelection?.kind === "sfx" ? sfxClips.find((c) => c.key === audioSelection.key) ?? null : null;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selectedSfx ? (
          <div className="editor-inspector-fields">
            <h3>効果音: {selectedSfx.label}</h3>
            <label className="editor-field">
              <span>開始(秒)</span>
              <input
                type="number"
                step={0.1}
                min={0}
                value={Math.round(selectedSfx.startFromSeconds * 10) / 10}
                onChange={(e) => onUpdateSfx(selectedSfx.key, { startFromSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="editor-field">
              <span>音量 {Math.round(selectedSfx.volume * 100)}%</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={selectedSfx.volume}
                onChange={(e) => onUpdateSfx(selectedSfx.key, { volume: Number(e.target.value) })}
              />
            </label>
            <button type="button" className="editor-toolbar-btn danger" onClick={() => onRemoveSfx(selectedSfx.key)}>
              削除
            </button>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>下の効果音ブロックを選択すると、ここでプロパティを編集できます</p>
          </div>
        )}
      </div>

      <div className="editor-inspector-footer">
        {sfxPresets.length > 0 ? (
          <select
            className="editor-toolbar-btn"
            value=""
            disabled={totalSfxCount >= maxSfxClips}
            onChange={(e) => {
              const preset = sfxPresets.find((p) => p.id === e.target.value);
              if (preset) onAddSfxPreset(preset);
              e.target.value = "";
            }}
          >
            <option value="" disabled>
              + 効果音(無料素材)
            </option>
            {sfxPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        ) : null}
        <label className="editor-toolbar-btn cursor-pointer">
          {sfxUploading ? "アップロード中..." : "+ 効果音をアップロード"}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={sfxUploading || totalSfxCount >= maxSfxClips}
            onChange={(e) => {
              onAddSfxFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
};
