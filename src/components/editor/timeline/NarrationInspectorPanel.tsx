"use client";

import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { WaitTime } from "@/components/WaitTime";
import type { AudioSelection } from "./TimelineRoot";
import { voiceLabel, type VoiceOption } from "@/lib/gemini/voiceOptions";
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
 * 一括生成の対象は「まだ無い分」と「今の声と違う声で作った分」(ClipEditor側で同じ判定をしている)。
 * 押す前に何件作るのか分かるよう、件数として見せる。
 */
const countNarration = (segments: ProjectSegment[], narrationClips: ProjectSfxClip[], narrationVoice: string) => {
  const generatedSegmentKeys = new Set(
    narrationClips.map((clip) => clip.narrationSegmentKey).filter((key): key is string => Boolean(key))
  );
  const captionedSegments = segments.filter((segment) => segment.caption.trim().length > 0);
  // 未作成のクリップ番号(1始まり)。字幕の無いクリップは作れないので含めない。
  const pendingNumbers = segments
    .map((segment, index) => ({ segment, number: index + 1 }))
    .filter(({ segment }) => segment.caption.trim().length > 0 && !generatedSegmentKeys.has(segment.key))
    .map(({ number }) => number);
  const mismatchedCount = narrationClips.filter(
    (clip) => clip.narrationSegmentKey && clip.narrationVoice !== narrationVoice
  ).length;
  return {
    generatedSegmentKeys,
    captionedCount: captionedSegments.length,
    missingCount: pendingNumbers.length,
    mismatchedCount,
    pendingCount: pendingNumbers.length + mismatchedCount,
    pendingNumbers,
  };
};

/** 読み上げる声の選択。一括生成とクリップごとの生成の両方の横に置く(どちらも同じ声の設定を使う)。 */
const VoiceSelect: React.FC<Pick<Props, "voiceOptions" | "narrationVoice" | "onChangeNarrationVoice" | "narrationGenerating">> = ({
  voiceOptions,
  narrationVoice,
  onChangeNarrationVoice,
  narrationGenerating,
}) => (
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
);

/**
 * AIナレーションの一括生成。全クリップへの操作なので、字幕タブの「全クリップの字幕」欄に
 * 字幕の一括操作と段を分けて置く。声の選択と横に並べ、どのクリップが未作成かを下に出す。
 * 生成中は中断ボタンに変わる(1件だけの生成中も同じ)。
 */
export const NarrationBulkGenerate: React.FC<Props> = (props) => {
  const { segments, narrationClips, totalSfxCount, maxSfxClips, narrationGenerating, narrationVoice } = props;
  // 「あと何件ぶんAPIを使うのか」は、未作成のクリップ番号として下に出す。
  const { captionedCount, missingCount, mismatchedCount, pendingCount, pendingNumbers } = countNarration(
    segments,
    narrationClips,
    narrationVoice
  );
  const atLimit = totalSfxCount >= maxSfxClips;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <VoiceSelect {...props} />
        {narrationGenerating ? (
          <button type="button" className="editor-toolbar-btn danger" onClick={props.onCancelNarrationGeneration}>
            生成中... ({narrationGenerating.current}/{narrationGenerating.total}) 中断
          </button>
        ) : (
          <button
            type="button"
            className="editor-toolbar-btn primary"
            disabled={pendingCount === 0 || atLimit}
            onClick={props.onGenerateNarrationForAll}
            title={
              atLimit
                ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
                : pendingCount === 0
                  ? captionedCount === 0
                    ? "字幕を入れると生成できます"
                    : "字幕のあるクリップは全て生成済みです"
                  : "まだ無い分を作り、違う声で作ってある分は今の声で作り直して、声をそろえます"
            }
          >
            <MicIcon size={14} />
            {missingCount > 0 && mismatchedCount > 0
              ? "一括生成・声をそろえる"
              : mismatchedCount > 0
                ? "この声にそろえる"
                : "一括生成"}
          </button>
        )}
      </div>
      <WaitTime
        task="narration"
        units={narrationGenerating?.total ?? 1}
        active={narrationGenerating !== null}
        progress={narrationGenerating ? (narrationGenerating.current - 1) / narrationGenerating.total : null}
      />
      {missingCount > 0 ? (
        <p className="settings-hint">未作成: {pendingNumbers.map((n) => `クリップ${n}`).join("、")}</p>
      ) : captionedCount > 0 && mismatchedCount === 0 ? (
        <p className="settings-hint">字幕のあるクリップは、すべて作成済みです</p>
      ) : null}
      {mismatchedCount > 0 && !narrationGenerating ? (
        <p className="settings-hint">
          今の声と違う声のナレーションが{mismatchedCount}件あります。上のボタンで今の声にそろえられます
        </p>
      ) : null}
      {/* ナレーションと本人の話し声が重なって聞き取りにくくならないよう、元の音を消せるようにする */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={props.muteOriginalUnderNarration}
          onChange={(e) => props.onChangeMuteOriginalUnderNarration(e.target.checked)}
        />
        ナレーションを入れたクリップは、元の音(話し声など)を消す
      </label>
    </>
  );
};

/**
 * 字幕タブの「AIナレーション」欄(旧「AI音声」タブ)。選んだクリップだけの生成・作り直し(声の選択と横並び)と、
 * 生成済みナレーションの開始秒・音量・削除を扱う。全クリップ分の一括生成は「全クリップの字幕」欄
 * (NarrationBulkGenerate)に置く。字幕の見た目の次に置くため、パネルの枠は持たず小見出し付きのまとまりだけを返す。
 */
export const NarrationInspectorPanel: React.FC<Props> = (props) => {
  const {
    segments,
    selectedSegmentKey,
    audioSelection,
    narrationClips,
    totalSfxCount,
    maxSfxClips,
    onUpdateSfx,
    onRemoveSfx,
    narrationVoice,
    muteOriginalUnderNarration,
    onChangeSegmentVolume,
    narrationGenerating,
    onGenerateNarrationForSegment,
  } = props;
  const selectedSegmentIndex = selectedSegmentKey
    ? segments.findIndex((segment) => segment.key === selectedSegmentKey)
    : -1;
  const selectedSegment = selectedSegmentIndex >= 0 ? segments[selectedSegmentIndex] : null;
  // タイムラインのAI音声の段で選んだナレーション。段を選んでいなくても、選んだクリップに生成済みの
  // ナレーションがあればそれを編集できるようにする(生成した後に、すぐ音量や削除を触れるように)。
  const selected =
    (audioSelection?.kind === "sfx" ? narrationClips.find((c) => c.key === audioSelection.key) : undefined) ??
    (selectedSegment ? narrationClips.find((c) => c.narrationSegmentKey === selectedSegment.key) : undefined) ??
    null;

  const { generatedSegmentKeys } = countNarration(segments, narrationClips, narrationVoice);
  const selectedHasNarration = selectedSegment ? generatedSegmentKeys.has(selectedSegment.key) : false;
  const atLimit = totalSfxCount >= maxSfxClips;

  return (
    <SettingsSection title="AIナレーション(字幕の読み上げ)" icon={<MicIcon size={16} />}>
      <p className="settings-hint">字幕の文章を、AIの声で読み上げた音声にして動画に付けます</p>
      {/* 声の選択と、選んだクリップだけの生成・作り直しを横に並べる */}
      <div className="flex flex-wrap gap-2">
        <VoiceSelect {...props} />
        {selectedSegment ? (
          <button
            type="button"
            className="editor-toolbar-btn"
            disabled={
              selectedSegment.caption.trim().length === 0 ||
              narrationGenerating !== null ||
              (!selectedHasNarration && atLimit)
            }
            onClick={() => onGenerateNarrationForSegment(selectedSegment.key)}
            title={
              !selectedHasNarration && atLimit
                ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
                : selectedHasNarration
                  ? "このクリップのナレーションを作り直して差し替えます"
                  : "このテロップをAIナレーション(読み上げ音声)に変換して追加します"
            }
          >
            <MicIcon size={14} />
            {selectedHasNarration
              ? `クリップ${selectedSegmentIndex + 1}だけ作り直す`
              : `クリップ${selectedSegmentIndex + 1}だけ生成`}
          </button>
        ) : null}
      </div>
      {/* 全体のスイッチ(全クリップの字幕の欄)とは別に、このクリップだけ話し声を消したい時のため。生成した場所ですぐ切り替えられるようにする */}
      {selectedSegment ? (
        <>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedSegment.volume === 0 || (muteOriginalUnderNarration && selectedHasNarration)}
              disabled={muteOriginalUnderNarration && selectedHasNarration}
              onChange={(e) => onChangeSegmentVolume(selectedSegment.key, e.target.checked ? 0 : 1)}
            />
            <span className="field-label">クリップ{selectedSegmentIndex + 1}の話し声を消す</span>
          </label>
          {muteOriginalUnderNarration && selectedHasNarration ? (
            <p className="settings-hint">
              「ナレーションを入れたクリップは、元の音を消す」がONなので、このクリップの話し声は消えています
            </p>
          ) : null}
        </>
      ) : null}

      {selected ? (
        <div className="field-group">
          <p className="text-xs font-bold" style={{ color: "var(--muted)" }}>
            生成したナレーション: {selected.label}(声: {voiceLabel(selected.narrationVoice)})
          </p>
          <div className="editor-field-row">
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
          </div>
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
      ) : null}
    </SettingsSection>
  );
};
