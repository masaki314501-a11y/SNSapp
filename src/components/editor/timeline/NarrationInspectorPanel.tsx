"use client";

import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { WaitTime } from "@/components/WaitTime";
import type { AudioSelection } from "./TimelineRoot";
import { voiceLabel, type VoiceOption } from "@/lib/gemini/voiceOptions";

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
  muteOriginalUnderNarration: boolean;
  onChangeMuteOriginalUnderNarration: (value: boolean) => void;
  /** 選んだクリップだけ本人の声を消す/戻す(クリップ自体の音量を0/1にする)。 */
  onChangeSegmentVolume: (key: string, volume: number) => void;
  /** AIナレーション生成中の進捗(単発生成もtotal=1として同じ状態を使う)。nullなら非実行中。 */
  narrationGenerating: { current: number; total: number } | null;
  onGenerateNarrationForSegment: (key: string) => void;
  onGenerateNarrationForAll: () => void;
  /** 実行中の一括生成を、今のクリップが終わった時点で止める。 */
  onCancelNarrationGeneration: () => void;
};

/**
 * 「AI音声」タブの右側パネル。読み上げの声選択・全クリップ一括生成、
 * 選択中クリップ単体の生成、生成済みナレーションクリップのプロパティ編集を扱う。
 * (映像トラックはこのタブでも表示したままなので、クリップを選んで個別生成できる)
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
  muteOriginalUnderNarration,
  onChangeMuteOriginalUnderNarration,
  onChangeSegmentVolume,
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

  // 一括生成の対象は「まだ無い分」と「今の声と違う声で作った分」(ClipEditor側で同じ判定をしている)。
  // 押す前に何件作るのか分かるよう、件数として見せる。
  const generatedSegmentKeys = new Set(
    narrationClips.map((clip) => clip.narrationSegmentKey).filter((key): key is string => Boolean(key))
  );
  const captionedSegments = segments.filter((segment) => segment.caption.trim().length > 0);
  const missingCount = captionedSegments.filter((segment) => !generatedSegmentKeys.has(segment.key)).length;
  const mismatchedCount = narrationClips.filter(
    (clip) => clip.narrationSegmentKey && clip.narrationVoice !== narrationVoice
  ).length;
  const pendingCount = missingCount + mismatchedCount;
  const bulkLabel =
    missingCount > 0 && mismatchedCount > 0
      ? `🎙 未生成の${missingCount}件を作り、${mismatchedCount}件をこの声にそろえる`
      : mismatchedCount > 0
        ? `🎙 ${mismatchedCount}件をこの声にそろえる`
        : `🎙 未生成の${missingCount}件を一括生成`;
  const selectedHasNarration = selectedSegment ? generatedSegmentKeys.has(selectedSegment.key) : false;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selected ? (
          <div className="editor-inspector-fields">
            <h3>ナレーション: {selected.label}</h3>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              声: {voiceLabel(selected.narrationVoice)}
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
            <button type="button" className="editor-toolbar-btn danger" onClick={() => onRemoveSfx(selected.key)}>
              削除
            </button>
          </div>
        ) : selectedSegment ? (
          <div className="editor-inspector-fields">
            <h3>クリップ{selectedSegmentIndex + 1}</h3>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              {selectedSegment.caption || "(テロップ無し)"}
            </p>
            <button
              type="button"
              className="editor-toolbar-btn"
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
              {narrationGenerating
                ? "生成中..."
                : selectedHasNarration
                  ? "🎙 このクリップのナレーションを作り直す"
                  : "🎙 このクリップのナレーション生成"}
            </button>
            {/* 全体のスイッチ(下)とは別に、このクリップだけ話し声を消したい時のため。生成した場所ですぐ切り替えられるようにする */}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedSegment.volume === 0 || (muteOriginalUnderNarration && selectedHasNarration)}
                disabled={muteOriginalUnderNarration && selectedHasNarration}
                onChange={(e) => onChangeSegmentVolume(selectedSegment.key, e.target.checked ? 0 : 1)}
              />
              <span className="field-label">このクリップの話し声を消す</span>
            </label>
            {muteOriginalUnderNarration && selectedHasNarration ? (
              <p className="text-xs" style={{ color: "var(--muted-2)" }}>
                下の「ナレーションを入れたクリップは、元の音を消す」がONなので、このクリップの話し声は消えています
              </p>
            ) : null}
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>映像クリップまたはナレーションブロックを選択すると、ここで生成・編集できます</p>
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
                  : "まだ無い分を作り、違う声で作ってある分は今の声で作り直して、声をそろえます"
            }
          >
            {bulkLabel}
          </button>
        )}
        <WaitTime
          className="basis-full"
          task="narration"
          units={narrationGenerating?.total ?? 1}
          active={narrationGenerating !== null}
          progress={narrationGenerating ? (narrationGenerating.current - 1) / narrationGenerating.total : null}
        />
        {mismatchedCount > 0 && !narrationGenerating ? (
          <p className="editor-toolbar-hint">
            今の声と違う声のナレーションが{mismatchedCount}件あります。上のボタンで今の声にそろえられます
          </p>
        ) : null}
        {/* ナレーションと本人の話し声が重なって聞き取りにくくならないよう、元の音を消せるようにする */}
        <label className="flex basis-full items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={muteOriginalUnderNarration}
            onChange={(e) => onChangeMuteOriginalUnderNarration(e.target.checked)}
          />
          ナレーションを入れたクリップは、元の音(話し声など)を消す
        </label>
      </div>
    </div>
  );
};
