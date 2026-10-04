"use client";

import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import type { AudioSelection } from "./TimelineRoot";
import type { VoiceOption } from "@/lib/gemini/voiceOptions";
import { MicIcon, TrashIcon } from "@/components/icons";
import { SettingsSection } from "../SettingsSection";

type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
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
  onGenerateNarrationForSegment: (key: string) => void;
  onGenerateNarrationForAll: () => void;
  /** 実行中の一括生成を、今のクリップが終わった時点で止める。 */
  onCancelNarrationGeneration: () => void;
};

/**
 * 字幕タブの「AIナレーション」欄(旧「AI音声」タブ)。テロップを読み上げる声の選択・全クリップ一括生成、
 * 選択中クリップ単体の生成、生成済みナレーション(タイムラインのAI音声の段)の開始秒・音量・削除を扱う。
 */
export const NarrationInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
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
  onGenerateNarrationForSegment,
  onGenerateNarrationForAll,
  onCancelNarrationGeneration,
}) => {
  const selected =
    audioSelection?.kind === "sfx" ? narrationClips.find((c) => c.key === audioSelection.key) ?? null : null;
  const selectedSegmentIndex = selectedSegmentKey
    ? segments.findIndex((segment) => segment.key === selectedSegmentKey)
    : -1;
  const selectedSegment = selectedSegmentIndex >= 0 ? segments[selectedSegmentIndex] : null;

  // 生成済みのクリップは一括生成の対象外になる(ClipEditor側で同じ判定をしている)。
  // 「あと何件ぶんAPIを使うのか」が押す前に分かるよう、残り件数として見せる。
  const generatedSegmentKeys = new Set(
    narrationClips.map((clip) => clip.narrationSegmentKey).filter((key): key is string => Boolean(key))
  );
  const captionedSegments = segments.filter((segment) => segment.caption.trim().length > 0);
  const pendingCount = captionedSegments.filter((segment) => !generatedSegmentKeys.has(segment.key)).length;
  const selectedHasNarration = selectedSegment ? generatedSegmentKeys.has(selectedSegment.key) : false;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        <SettingsSection title="AIナレーション" icon={<MicIcon size={16} />}>
          {selected ? (
            <div className="editor-inspector-fields">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                選んだナレーション: {selected.label}
              </p>
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
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.volume === 0}
                  onChange={(e) => onUpdateSfx(selected.key, { volume: e.target.checked ? 0 : 1 })}
                />
                <span className="field-label">ミュート</span>
              </label>
              <button type="button" className="editor-toolbar-btn danger self-start" onClick={() => onRemoveSfx(selected.key)}>
                <TrashIcon size={14} />
                このナレーションを削除
              </button>
            </div>
          ) : selectedSegment ? (
            <button
              type="button"
              className="editor-toolbar-btn self-start"
              disabled={
                selectedSegment.caption.trim().length === 0 ||
                narrationGenerating !== null ||
                (!selectedHasNarration && totalSfxCount >= maxSfxClips)
              }
              onClick={() => onGenerateNarrationForSegment(selectedSegment.key)}
              title={
                !selectedHasNarration && totalSfxCount >= maxSfxClips
                  ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
                  : selectedHasNarration
                    ? "このクリップのナレーションを作り直して差し替えます"
                    : "このテロップをAIナレーション(読み上げ音声)に変換して追加します"
              }
            >
              <MicIcon size={14} />
              {narrationGenerating
                ? "生成中..."
                : selectedHasNarration
                  ? `クリップ${selectedSegmentIndex + 1}のナレーションを作り直す`
                  : `クリップ${selectedSegmentIndex + 1}のナレーションを生成`}
            </button>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              クリップを選ぶとそのテロップを、タイムラインのAI音声の段を選ぶとそのナレーションを編集できます
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="editor-toolbar-btn"
              value={narrationVoice}
              disabled={narrationGenerating !== null}
              onChange={(e) => onChangeNarrationVoice(e.target.value)}
              aria-label="AIナレーションの声"
            >
              {voiceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  声: {option.label}
                </option>
              ))}
            </select>
            {narrationGenerating ? (
              <button type="button" className="editor-toolbar-btn danger" onClick={onCancelNarrationGeneration}>
                生成中... ({narrationGenerating.current}/{narrationGenerating.total}) 中断
              </button>
            ) : (
              <button
                type="button"
                className="editor-toolbar-btn"
                disabled={pendingCount === 0 || totalSfxCount >= maxSfxClips}
                onClick={onGenerateNarrationForAll}
                title={
                  totalSfxCount >= maxSfxClips
                    ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
                    : pendingCount === 0
                      ? "テロップのあるクリップは全て生成済みです"
                      : `まだナレーションが無い${pendingCount}件だけを、順番に生成して追加します(生成済みの分はAPIを使いません)`
                }
              >
                <MicIcon size={14} />
                未生成の{pendingCount}件を一括生成
              </button>
            )}
          </div>
        </SettingsSection>
      </div>
    </div>
  );
};
