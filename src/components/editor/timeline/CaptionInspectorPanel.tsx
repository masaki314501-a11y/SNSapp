"use client";

import type { ProjectSegment } from "@/lib/videoProject";
import {
  CAPTION_ANIMATION_OPTIONS,
  type CaptionAnimation,
} from "@video/shared/schema";
import { CaptionIcon, EditIcon, HighlightIcon, PaletteIcon, SparkleIcon, TrashIcon } from "@/components/icons";
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
  /** AIナレーションの欄(NarrationInspectorPanel)。一括操作のすぐ下に置く。 */
  narrationSection: React.ReactNode;
  /** 字幕の見た目のうち、全クリップ共通の設定(プリセット・配色・フォント等。ClipEditor側で組み立てる)。 */
  lookSettings: React.ReactNode;
};

/**
 * 「字幕」タブのパネル。上から順に、全クリップへの一括操作 → AIナレーション(旧「AI音声」タブ) →
 * 選んだクリップの字幕 → 字幕の見た目(強調する単語と、旧「見た目」タブの設定) → 出現演出、と並べる。
 * よく使う一括操作とナレーションを上に、細かい見た目の調整を下に置く。
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
  narrationSection,
  lookSettings,
}) => {
  const selectedIndex = selectedSegmentKey ? segments.findIndex((s) => s.key === selectedSegmentKey) : -1;
  const selectedSegment = selectedIndex >= 0 ? segments[selectedIndex] : null;

  const multiSelectedNote =
    selectedCount > 1 ? (
      <div className="editor-inspector-empty">
        <p>{selectedCount}件のクリップを選択中です。複数クリップの字幕は一括編集をお使いください</p>
      </div>
    ) : null;
  const noSelectionNote = (
    <div className="editor-inspector-empty">
      <p>クリップを選択すると、ここで字幕を編集できます</p>
    </div>
  );
  const target = selectedCount > 1 ? null : selectedSegment;

  return (
    <div className="editor-inspector">
      <div className="editor-inspector-body">
        {/* 全クリップへの操作。クリップを選んでいなくても使うため一番上に置く(小見出しで字幕の操作と分かるので、ボタンに「字幕を」は付けない) */}
        <SettingsSection title="全クリップの字幕" icon={<CaptionIcon size={16} />}>
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
              {captionsGenerating ? "生成中..." : "一括生成"}
            </button>
            <button
              type="button"
              className="editor-toolbar-btn"
              onClick={onOpenBulkEdit}
              disabled={!canOpenBulkEdit}
              title="全クリップの字幕を、まとめて文章で編集します"
            >
              <EditIcon size={14} />
              一括編集
            </button>
            <button
              type="button"
              className="editor-toolbar-btn danger"
              onClick={onClearCaptions}
              disabled={!hasAnyCaption}
              title="全クリップの字幕を削除します(確認してから削除します)"
            >
              <TrashIcon size={14} />
              一括削除
            </button>
          </div>
        </SettingsSection>

        {narrationSection}

        <SettingsSection title="クリップの字幕" icon={<EditIcon size={16} />}>
          {multiSelectedNote ??
            (target ? (
              <label className="editor-field">
                <span>テロップ</span>
                <textarea
                  value={target.caption}
                  placeholder="(無音・字幕なし)"
                  onChange={(e) => onUpdateSegment(target.key, { caption: e.target.value })}
                />
              </label>
            ) : (
              noSelectionNote
            ))}
        </SettingsSection>

        {/* 強調する単語(クリップごと)と、全クリップ共通の見た目を1つの欄にまとめる */}
        <SettingsSection title="字幕の見た目" icon={<PaletteIcon size={16} />}>
          {target ? (
            <div className="editor-field-row">
              <label className="editor-field">
                <span>強調する単語(、区切り)</span>
                <input
                  type="text"
                  value={(target.emphasisWords ?? []).join("、")}
                  placeholder="例: 3倍、結論"
                  onChange={(e) => {
                    const words = e.target.value
                      .split(/[、,]/)
                      .map((w) => w.trim())
                      .filter((w) => w.length > 0);
                    onUpdateEmphasis(target.key, { emphasisWords: words.length > 0 ? words : undefined });
                  }}
                />
              </label>
              <label className="editor-field">
                <span>強調の色</span>
                <input
                  type="color"
                  value={target.emphasisColor ?? DEFAULT_EMPHASIS_COLOR}
                  onChange={(e) => onUpdateEmphasis(target.key, { emphasisColor: e.target.value })}
                />
              </label>
            </div>
          ) : null}
          {lookSettings}
        </SettingsSection>

        <SettingsSection title="出現演出" icon={<HighlightIcon size={16} />}>
          {multiSelectedNote ??
            (target ? (
              <>
                <label className="editor-field">
                  <span>字幕の出方</span>
                  <select
                    value={target.captionAnimation}
                    onChange={(e) =>
                      onUpdateSegment(target.key, { captionAnimation: e.target.value as CaptionAnimation })
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
                  onClick={() => onApplyAnimationToAll(target.captionAnimation)}
                >
                  この出現演出を全クリップに適用
                </button>
              </>
            ) : (
              noSelectionNote
            ))}
        </SettingsSection>
      </div>
    </div>
  );
};
