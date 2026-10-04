"use client";

import type { ProjectSegment } from "@/lib/videoProject";
import {
  CAPTION_ANIMATION_OPTIONS,
  type CaptionAnimation,
} from "@video/shared/schema";
import { CaptionIcon, EditIcon, HighlightIcon, SparkleIcon, TrashIcon } from "@/components/icons";
import { SettingsSection } from "../SettingsSection";

const DEFAULT_EMPHASIS_COLOR = "#FFE600";

type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  onUpdateSegment: (
    key: string,
    patch: Partial<Pick<ProjectSegment, "caption" | "captionAnimation">>
  ) => void;
  /** 字幕の中で強調する単語と、その色(旧・演出タブの「字幕の強調」)。 */
  onUpdateEmphasis: (key: string, patch: Partial<Pick<ProjectSegment, "emphasisWords" | "emphasisColor">>) => void;
  onApplyAnimationToAll: (animation: CaptionAnimation) => void;
  onOpenBulkEdit: () => void;
  canOpenBulkEdit: boolean;
  onGenerateCaptionsForAll: () => void;
  captionsGenerating: boolean;
  captionsError: string | null;
  onClearCaptions: () => void;
  hasAnyCaption: boolean;
};

/**
 * 「字幕」タブのうち、選択中クリップのテロップ文言・出現演出・強調する単語と、全クリップへの一括操作を扱う部分。
 * AIナレーション(旧「AI音声」タブ)と字幕の見た目(旧「見た目」タブ)も同じ字幕タブに並べる
 * (ClipEditor側で NarrationInspectorPanel と字幕の見た目の欄をこの下に続けて置く)。
 */
export const CaptionInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  onUpdateSegment,
  onUpdateEmphasis,
  onApplyAnimationToAll,
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
        <SettingsSection title="クリップの字幕" icon={<CaptionIcon size={16} />}>
          {selectedCount > 1 ? (
            <div className="editor-inspector-empty">
              <p>{selectedCount}件のクリップを選択中です。複数クリップの字幕は一括編集をお使いください</p>
            </div>
          ) : selectedSegment ? (
            <div className="editor-inspector-fields">
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
                  onChange={(e) =>
                    onUpdateSegment(selectedSegment.key, { captionAnimation: e.target.value as CaptionAnimation })
                  }
                >
                  {CAPTION_ANIMATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="editor-toolbar-btn self-start"
                onClick={() => onApplyAnimationToAll(selectedSegment.captionAnimation)}
              >
                この演出を全クリップに適用
              </button>
            </div>
          ) : (
            <div className="editor-inspector-empty">
              <p>クリップを選択すると、ここで字幕を編集できます</p>
            </div>
          )}
        </SettingsSection>

        {selectedCount <= 1 && selectedSegment ? (
          <SettingsSection title="字幕の強調" icon={<HighlightIcon size={16} />}>
            <div className="editor-field-row">
              <label className="editor-field">
                <span>強調する単語(、区切り)</span>
                <input
                  type="text"
                  value={(selectedSegment.emphasisWords ?? []).join("、")}
                  placeholder="例: 3倍、結論"
                  onChange={(e) => {
                    const words = e.target.value
                      .split(/[、,]/)
                      .map((w) => w.trim())
                      .filter((w) => w.length > 0);
                    onUpdateEmphasis(selectedSegment.key, { emphasisWords: words.length > 0 ? words : undefined });
                  }}
                />
              </label>
              <label className="editor-field">
                <span>強調の色</span>
                <input
                  type="color"
                  value={selectedSegment.emphasisColor ?? DEFAULT_EMPHASIS_COLOR}
                  onChange={(e) => onUpdateEmphasis(selectedSegment.key, { emphasisColor: e.target.value })}
                />
              </label>
            </div>
          </SettingsSection>
        ) : null}
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
            <SparkleIcon size={14} />
            {captionsGenerating ? "字幕を生成中..." : "字幕を一括生成"}
          </button>
          <button type="button" className="editor-toolbar-btn" onClick={onOpenBulkEdit} disabled={!canOpenBulkEdit}>
            <EditIcon size={14} />
            字幕を一括編集
          </button>
          <button type="button" className="editor-toolbar-btn danger" onClick={onClearCaptions} disabled={!hasAnyCaption}>
            <TrashIcon size={14} />
            字幕を全部消す
          </button>
        </div>
      </div>
    </div>
  );
};
