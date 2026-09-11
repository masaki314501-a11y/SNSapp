"use client";

import type { ProjectSegment } from "@/lib/videoProject";
import { canMergeWithNext } from "../timelineUtils";
import {
  CAPTION_ANIMATION_OPTIONS,
  type CaptionAnimation,
} from "@video/shared/schema";

type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  sfxCount: number;
  maxSfxClips: number;
  onUpdateSegment: (
    key: string,
    patch: Partial<Pick<ProjectSegment, "caption" | "startFromSeconds" | "durationInSeconds" | "captionAnimation" | "volume">>
  ) => void;
  onApplyAnimationToAll: (animation: CaptionAnimation) => void;
  onMergeWithNext: (key: string) => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
  onDeleteSelected: () => void;
  /** AIナレーション生成中の進捗(単発生成もtotal=1として同じ状態を使う)。nullなら非実行中。 */
  narrationGenerating: { current: number; total: number } | null;
  onGenerateNarrationForSegment: (key: string) => void;
};

/**
 * 「クリップ」タブの右側パネル。選択中クリップのプロパティ・操作のみを扱う
 * (SE/BGM/AIナレーションの追加・一覧編集は「音声」タブのAudioInspectorPanelが担当)。
 */
export const ClipInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  sfxCount,
  maxSfxClips,
  onUpdateSegment,
  onApplyAnimationToAll,
  onMergeWithNext,
  onDuplicate,
  onRemove,
  onDeleteSelected,
  narrationGenerating,
  onGenerateNarrationForSegment,
}) => {
  const selectedIndex = selectedSegmentKey ? segments.findIndex((s) => s.key === selectedSegmentKey) : -1;
  const selectedSegment = selectedIndex >= 0 ? segments[selectedIndex] : null;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selectedCount > 1 ? (
          <div className="editor-inspector-empty">
            <p>{selectedCount}件のクリップを選択中</p>
            <button type="button" className="editor-toolbar-btn danger" onClick={onDeleteSelected}>
              選択したクリップを削除
            </button>
          </div>
        ) : selectedSegment ? (
          <div className="editor-inspector-fields">
            <h3>クリップ{selectedIndex + 1}</h3>
            <label className="editor-field">
              <span>テロップ</span>
              <textarea
                value={selectedSegment.caption}
                placeholder="(無音・字幕なし)"
                onChange={(e) => onUpdateSegment(selectedSegment.key, { caption: e.target.value })}
              />
            </label>
            <div className="editor-field-row">
              <label className="editor-field">
                <span>開始(秒)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={Math.round(selectedSegment.startFromSeconds * 10) / 10}
                  onChange={(e) => onUpdateSegment(selectedSegment.key, { startFromSeconds: Number(e.target.value) })}
                />
              </label>
              <label className="editor-field">
                <span>長さ(秒)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={Math.round(selectedSegment.durationInSeconds * 10) / 10}
                  onChange={(e) => onUpdateSegment(selectedSegment.key, { durationInSeconds: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="editor-field">
              <span>演出</span>
              <select
                value={selectedSegment.captionAnimation}
                onChange={(e) => onUpdateSegment(selectedSegment.key, { captionAnimation: e.target.value as CaptionAnimation })}
              >
                {CAPTION_ANIMATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="editor-toolbar-btn" onClick={() => onApplyAnimationToAll(selectedSegment.captionAnimation)}>
              この演出を全部に適用
            </button>
            <label className="editor-field">
              <span>音量 {Math.round(selectedSegment.volume * 100)}%</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={selectedSegment.volume}
                onChange={(e) => onUpdateSegment(selectedSegment.key, { volume: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedSegment.volume === 0}
                onChange={(e) =>
                  onUpdateSegment(selectedSegment.key, { volume: e.target.checked ? 0 : 1 })
                }
              />
              <span className="field-label">元の音声をミュート(ナレーションやBGMだけにする)</span>
            </label>
            <div className="editor-inspector-actions">
              <button
                type="button"
                className="editor-toolbar-btn"
                disabled={
                  selectedSegment.caption.trim().length === 0 ||
                  narrationGenerating !== null ||
                  sfxCount >= maxSfxClips
                }
                onClick={() => onGenerateNarrationForSegment(selectedSegment.key)}
                title={
                  sfxCount >= maxSfxClips
                    ? `効果音/ナレーションの上限(${maxSfxClips}件)に達しています`
                    : "このテロップをAIナレーション(読み上げ音声)に変換してSEと同じ扱いで追加します(声の種類は「音声」タブで選べます)"
                }
              >
                {narrationGenerating ? "生成中..." : "🎙 ナレーション生成"}
              </button>
              <button type="button" className="editor-toolbar-btn" onClick={() => onDuplicate(selectedSegment.key)}>
                複製
              </button>
              <button
                type="button"
                className="editor-toolbar-btn"
                disabled={!canMergeWithNext(segments, selectedIndex)}
                onClick={() => onMergeWithNext(selectedSegment.key)}
                title="次のクリップと結合します(元動画上で連続している場合のみ)"
              >
                結合
              </button>
              <button type="button" className="editor-toolbar-btn danger" onClick={() => onRemove(selectedSegment.key)}>
                削除
              </button>
            </div>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>クリップを選択すると、ここでプロパティを編集できます</p>
          </div>
        )}
      </div>
    </div>
  );
};
