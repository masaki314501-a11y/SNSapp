"use client";

import type { ProjectSegment } from "@/lib/videoProject";
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
    patch: Partial<Pick<ProjectSegment, "caption" | "captionAnimation">>
  ) => void;
  onApplyAnimationToAll: (animation: CaptionAnimation) => void;
  /** AIナレーション生成中の進捗(単発生成もtotal=1として同じ状態を使う)。nullなら非実行中。 */
  narrationGenerating: { current: number; total: number } | null;
  onGenerateNarrationForSegment: (key: string) => void;
  onOpenBulkEdit: () => void;
  canOpenBulkEdit: boolean;
  onGenerateCaptionsForAll: () => void;
  captionsGenerating: boolean;
  captionsError: string | null;
  onClearCaptions: () => void;
  hasAnyCaption: boolean;
};

/**
 * 「字幕」タブの右側パネル。選択中クリップのテロップ文言・出現演出のみを扱う
 * (尺・音量は「動画カット」タブ、AIナレーションの声選択・一括生成は「AI音声」タブが担当。
 * このタブにあるのは、テロップを書きながらその場でナレーションを試せるようにするため)。
 */
export const CaptionInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  sfxCount,
  maxSfxClips,
  onUpdateSegment,
  onApplyAnimationToAll,
  narrationGenerating,
  onGenerateNarrationForSegment,
  onOpenBulkEdit,
  canOpenBulkEdit,
  onGenerateCaptionsForAll,
  captionsGenerating,
  captionsError,
  onClearCaptions,
  hasAnyCaption,
}) => {
  const selectedIndex = selectedSegmentKey ? segments.findIndex((s) => s.key === selectedSegmentKey) : -1;
  const selectedSegment = selectedIndex >= 0 ? segments[selectedIndex] : null;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {selectedCount > 1 ? (
          <div className="editor-inspector-empty">
            <p>{selectedCount}件のクリップを選択中です。複数クリップの字幕は一括編集をお使いください</p>
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
                  : "このテロップをAIナレーション(読み上げ音声)に変換して追加します(声の種類は「AI音声」タブで選べます)"
              }
            >
              {narrationGenerating ? "生成中..." : "🎙 このクリップのナレーション生成"}
            </button>
          </div>
        ) : (
          <div className="editor-inspector-empty">
            <p>クリップを選択すると、ここで字幕を編集できます</p>
          </div>
        )}
      </div>

      <div className="editor-inspector-footer flex flex-col gap-2">
        {captionsError ? <p className="badge-pill danger w-fit">{captionsError}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="editor-toolbar-btn"
            onClick={onGenerateCaptionsForAll}
            disabled={!canOpenBulkEdit || captionsGenerating}
            title="全クリップに、話している内容を字幕として付けます(今ある字幕は上書きされます)"
          >
            {captionsGenerating ? "字幕を生成中..." : "字幕を一括生成"}
          </button>
          <button type="button" className="editor-toolbar-btn" onClick={onOpenBulkEdit} disabled={!canOpenBulkEdit}>
            字幕を一括編集
          </button>
          <button type="button" className="editor-toolbar-btn" onClick={onClearCaptions} disabled={!hasAnyCaption}>
            字幕を全部消す
          </button>
        </div>
      </div>
    </div>
  );
};
