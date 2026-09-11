"use client";

import type { ProjectBgm, ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import type { AudioSelection } from "./TimelineRoot";
import type { AudioPreset } from "../audioPresets";
import type { VoiceOption } from "@/lib/gemini/voiceOptions";

type Props = {
  segments: ProjectSegment[];
  audioSelection: AudioSelection;
  sfxClips: ProjectSfxClip[];
  bgm: ProjectBgm | null;
  sfxUploading: boolean;
  bgmUploading: boolean;
  maxSfxClips: number;
  sfxPresets: AudioPreset[];
  bgmPresets: AudioPreset[];
  onUpdateSfx: (key: string, patch: Partial<Pick<ProjectSfxClip, "startFromSeconds" | "volume">>) => void;
  onRemoveSfx: (key: string) => void;
  onSetBgmField: (patch: Partial<Pick<ProjectBgm, "volume" | "fadeInSeconds" | "fadeOutSeconds">>) => void;
  onRemoveBgm: () => void;
  onAddSfxFile: (file: File | null) => void;
  onSetBgmFile: (file: File | null) => void;
  onAddSfxPreset: (preset: AudioPreset) => void;
  onSetBgmPreset: (preset: AudioPreset) => void;
  voiceOptions: VoiceOption[];
  narrationVoice: string;
  onChangeNarrationVoice: (voiceName: string) => void;
  /** AIナレーション生成中の進捗(単発生成もtotal=1として同じ状態を使う)。nullなら非実行中。 */
  narrationGenerating: { current: number; total: number } | null;
  onGenerateNarrationForAll: () => void;
};

/**
 * 「音声」タブの右側パネル。SE/BGMの選択中プロパティ編集と、SE/BGM/AIナレーションの
 * 追加操作をまとめる(クリップ自体のプロパティはClipInspectorPanel=「クリップ」タブが担当)。
 */
export const AudioInspectorPanel: React.FC<Props> = ({
  segments,
  audioSelection,
  sfxClips,
  bgm,
  sfxUploading,
  bgmUploading,
  maxSfxClips,
  sfxPresets,
  bgmPresets,
  onUpdateSfx,
  onRemoveSfx,
  onSetBgmField,
  onRemoveBgm,
  onAddSfxFile,
  onSetBgmFile,
  onAddSfxPreset,
  onSetBgmPreset,
  voiceOptions,
  narrationVoice,
  onChangeNarrationVoice,
  narrationGenerating,
  onGenerateNarrationForAll,
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
        ) : audioSelection?.kind === "bgm" && bgm ? (
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
            <p>下の効果音・BGMブロックを選択すると、ここでプロパティを編集できます</p>
          </div>
        )}
      </div>

      <div className="editor-inspector-footer">
        <select
          className="editor-toolbar-btn"
          value={narrationVoice}
          disabled={narrationGenerating !== null}
          onChange={(e) => onChangeNarrationVoice(e.target.value)}
          title="AIナレーションの声"
        >
          {voiceOptions.map((option) => (
            <option key={option.id} value={option.id}>
              🎙 {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="editor-toolbar-btn"
          disabled={
            narrationGenerating !== null ||
            segments.every((segment) => segment.caption.trim().length === 0) ||
            sfxClips.length >= maxSfxClips
          }
          onClick={onGenerateNarrationForAll}
          title={
            sfxClips.length >= maxSfxClips
              ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
              : "テロップが入っている全クリップ分、順番にAIナレーションを生成して追加します"
          }
        >
          {narrationGenerating ? `生成中... (${narrationGenerating.current}/${narrationGenerating.total})` : "🎙 全クリップに一括生成"}
        </button>
        {sfxPresets.length > 0 ? (
          <select
            className="editor-toolbar-btn"
            value=""
            disabled={sfxClips.length >= maxSfxClips}
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
            disabled={sfxUploading || sfxClips.length >= maxSfxClips}
            onChange={(e) => {
              onAddSfxFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
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
