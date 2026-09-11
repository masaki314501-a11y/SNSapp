"use client";

import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import type { AudioSelection } from "./TimelineRoot";
import type { VoiceOption } from "@/lib/gemini/voiceOptions";

type Props = {
  segments: ProjectSegment[];
  audioSelection: AudioSelection;
  /** AIナレーションのみ(SEを除く)。表示用のトラックも同じ絞り込みをしている。 */
  narrationClips: ProjectSfxClip[];
  /** SE+AIナレーション合計件数(上限判定用。上限は両者で共有のため絞り込み前の件数が必要)。 */
  totalSfxCount: number;
  maxSfxClips: number;
  onUpdateSfx: (key: string, patch: Partial<Pick<ProjectSfxClip, "startFromSeconds" | "volume">>) => void;
  onRemoveSfx: (key: string) => void;
  voiceOptions: VoiceOption[];
  narrationVoice: string;
  onChangeNarrationVoice: (voiceName: string) => void;
  /** AIナレーション生成中の進捗(単発生成もtotal=1として同じ状態を使う)。nullなら非実行中。 */
  narrationGenerating: { current: number; total: number } | null;
  onGenerateNarrationForAll: () => void;
};

/**
 * 「AI音声」タブの右側パネル。読み上げの声選択・全クリップ一括生成と、
 * 生成済みナレーションクリップのプロパティ編集。1クリップだけの生成は
 * 「字幕」タブ(そのクリップのテロップを見ながら生成できる)で行う。
 */
export const NarrationInspectorPanel: React.FC<Props> = ({
  segments,
  audioSelection,
  narrationClips,
  totalSfxCount,
  maxSfxClips,
  onUpdateSfx,
  onRemoveSfx,
  voiceOptions,
  narrationVoice,
  onChangeNarrationVoice,
  narrationGenerating,
  onGenerateNarrationForAll,
}) => {
  const selected =
    audioSelection?.kind === "sfx" ? narrationClips.find((c) => c.key === audioSelection.key) ?? null : null;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selected ? (
          <div className="editor-inspector-fields">
            <h3>ナレーション: {selected.label}</h3>
            <label className="editor-field">
              <span>開始(秒)</span>
              <input
                type="number"
                step={0.1}
                min={0}
                value={Math.round(selected.startFromSeconds * 10) / 10}
                onChange={(e) => onUpdateSfx(selected.key, { startFromSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="editor-field">
              <span>音量 {Math.round(selected.volume * 100)}%</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={selected.volume}
                onChange={(e) => onUpdateSfx(selected.key, { volume: Number(e.target.value) })}
              />
            </label>
            <button type="button" className="editor-toolbar-btn danger" onClick={() => onRemoveSfx(selected.key)}>
              削除
            </button>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>下のナレーションブロックを選択すると、ここでプロパティを編集できます</p>
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
            totalSfxCount >= maxSfxClips
          }
          onClick={onGenerateNarrationForAll}
          title={
            totalSfxCount >= maxSfxClips
              ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
              : "テロップが入っている全クリップ分、順番にAIナレーションを生成して追加します"
          }
        >
          {narrationGenerating ? `生成中... (${narrationGenerating.current}/${narrationGenerating.total})` : "🎙 全クリップに一括生成"}
        </button>
      </div>
    </div>
  );
};
