"use client";

import type { ProjectSegment } from "@/lib/videoProject";
import { WaitTime } from "@/components/WaitTime";
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  type CaptionAnimation,
  type CaptionPosition,
} from "@video/shared/schema";
import { WORD_SYNC_OPTIONS, type WordSyncMode } from "@video/shared/wordSync";
import { CaptionIcon, EditIcon, HighlightIcon, MicIcon, PaletteIcon, SparkleIcon, TrashIcon } from "@/components/icons";
import { Collapsible, SettingsSection } from "../SettingsSection";
import { CaptionEmphasisFields, KeywordHighlightFields } from "./CaptionEmphasisFields";
import { RECOMMENDED_CAPTION_STYLE_IDS, TextStylePicker } from "./TextStylePicker";


type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  onUpdateSegment: (
    key: string,
    patch: Partial<Pick<ProjectSegment, "caption" | "captionAnimation">>
  ) => void;
  /** 字幕の中で強調する単語と、その色(旧・演出タブの「字幕の強調」)。 */
  onUpdateEmphasis: (
    key: string,
    patch: Partial<
      Pick<
        ProjectSegment,
        "emphasisWords" | "emphasisColor" | "clipCaptionPosition" | "captionEmphasis" | "emphasisSfxPresetId"
      >
    >
  ) => void;
  /** 選んでいるクリップの字幕の文字スタイル(クリップを選んでいない時は全体の既定)と、全クリップ共通の重大ワード。 */
  captionTextStyleId: string | undefined;
  /** 文字スタイル・詳しい設定を変える範囲。clip=選んだクリップ、clips=選んだ複数のクリップ、all=全クリップの既定。 */
  textStyleScope: "clip" | "clips" | "all";
  onPickTextStyle: (id: string | undefined) => void;
  onApplyTextStyleToAll: () => void;
  keywordHighlights: { word: string; color: string }[];
  /** 字幕を話に合わせて見せるか(未指定の時に実際に使われる値を渡す)と、光らせる色。 */
  captionWordSync: WordSyncMode;
  captionWordHighlightColor: string | undefined;
  onUpdateCaptionLook: (patch: {
    captionTextStyleId?: string | undefined;
    keywordHighlights?: { word: string; color: string }[];
    captionWordSync?: WordSyncMode;
    captionWordHighlightColor?: string;
  }) => void;
  onApplyAnimationToAll: (animation: CaptionAnimation) => void;
  onOpenBulkEdit: () => void;
  canOpenBulkEdit: boolean;
  onGenerateCaptionsForAll: () => void;
  captionsGenerating: boolean;
  captionsError: string | null;
  /** 字幕の一括生成で文字起こしする動画の長さ(秒)。目安の待ち時間に使う。 */
  transcribeSeconds: number;
  onClearCaptions: () => void;
  hasAnyCaption: boolean;
  /** AIナレーションの一括生成(NarrationBulkGenerate)。「全クリップの字幕」欄に、字幕の一括操作と段を分けて置く。 */
  narrationBulkAction: React.ReactNode;
  /** クリップごとのAIナレーションの欄(NarrationInspectorPanel)。字幕の見た目の次に置く。 */
  narrationSection: React.ReactNode;
  /** 字幕の見た目の詳しい設定(配色・見た目・フォント・位置・大きさ。ClipEditor側で組み立て、文字スタイルと同じ範囲に使う)。 */
  lookSettings: React.ReactNode;
};

/**
 * 「字幕」タブのパネル。上から順に、全クリップへの一括操作(字幕とAIナレーションの一括生成) →
 * 選んだクリップの字幕 → このクリップの強調 → 重大ワード → 字幕の見た目(文字スタイルと、旧「見た目」タブの設定) →
 * クリップごとのAIナレーション(旧「AI音声」タブ) → 出現演出、と並べる。
 */
export const CaptionInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  onUpdateSegment,
  onUpdateEmphasis,
  captionTextStyleId,
  textStyleScope,
  onPickTextStyle,
  onApplyTextStyleToAll,
  keywordHighlights,
  captionWordSync,
  captionWordHighlightColor,
  onUpdateCaptionLook,
  onApplyAnimationToAll,
  onOpenBulkEdit,
  canOpenBulkEdit,
  onGenerateCaptionsForAll,
  captionsGenerating,
  transcribeSeconds,
  captionsError,
  onClearCaptions,
  hasAnyCaption,
  narrationBulkAction,
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
          <WaitTime task="transcribe" units={transcribeSeconds} active={captionsGenerating} failed={captionsError !== null} />
          <div className="bulk-subgroup">
            <p className="bulk-sublabel">
              <MicIcon size={14} />
              AIナレーション
            </p>
            {narrationBulkAction}
          </div>
        </SettingsSection>

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
          {/* 自動編集は、全体の位置だと顔に重なるクリップだけテロップの位置を変えている。ここで戻せる */}
          {!multiSelectedNote && target ? (
            <label className="editor-field">
              <span>このクリップのテロップの位置</span>
              <select
                value={target.clipCaptionPosition ?? ""}
                onChange={(e) =>
                  onUpdateEmphasis(target.key, {
                    clipCaptionPosition: (e.target.value || undefined) as CaptionPosition | undefined,
                  })
                }
              >
                <option value="">全体の設定と同じ</option>
                {CAPTION_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </SettingsSection>

        {/* 字幕の強調はAIに任せず、ここで本人が選ぶ(帯・書体・色・効果音) */}
        <SettingsSection title="このクリップの字幕の強調" icon={<SparkleIcon size={16} />}>
          {multiSelectedNote ??
            (target ? (
              <CaptionEmphasisFields segment={target} onChange={(patch) => onUpdateEmphasis(target.key, patch)} />
            ) : (
              noSelectionNote
            ))}
        </SettingsSection>

        <SettingsSection title="重大ワード(全クリップ)" icon={<HighlightIcon size={16} />}>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            ここに入れた言葉は、すべての字幕で選んだ色・少し大きい文字になります
          </span>
          <KeywordHighlightFields
            keywords={keywordHighlights}
            onChange={(next) => onUpdateCaptionLook({ keywordHighlights: next })}
          />
        </SettingsSection>

        {/* 字幕の見た目はここ1か所。まず文字スタイルのおすすめから選び、配色・フォント・位置などは「詳しい設定」に畳む */}
        <SettingsSection title="字幕の見た目" icon={<PaletteIcon size={16} />}>
          <div className="editor-field-row">
            <label className="editor-field">
              <span>話に合わせて</span>
              <select
                value={captionWordSync}
                onChange={(e) => onUpdateCaptionLook({ captionWordSync: e.target.value as WordSyncMode })}
              >
                {WORD_SYNC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {captionWordSync === "highlight" ? (
              <label className="editor-field" style={{ flex: "0 0 auto" }}>
                <span>光らせる色</span>
                <input
                  type="color"
                  value={captionWordHighlightColor ?? "#FFE600"}
                  onChange={(e) => onUpdateCaptionLook({ captionWordHighlightColor: e.target.value })}
                />
              </label>
            ) : null}
          </div>
          <TextStylePicker
            label={
              textStyleScope === "clip"
                ? "文字スタイル(選んだクリップ)"
                : textStyleScope === "clips"
                  ? "文字スタイル(選んだクリップすべて)"
                  : "文字スタイル(全クリップ)"
            }
            value={captionTextStyleId}
            onChange={onPickTextStyle}
            recommendedIds={RECOMMENDED_CAPTION_STYLE_IDS}
            emptyLabel="ふつう(下の詳しい設定の見た目)"
          />
          {textStyleScope !== "all" ? (
            <button type="button" className="editor-toolbar-btn self-start" onClick={onApplyTextStyleToAll}>
              この字幕の見た目を全クリップに使う
            </button>
          ) : null}
          <Collapsible summary="詳しい設定(配色・フォント・位置・大きさ)">
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              {textStyleScope === "all" ? "全クリップの字幕に使います" : "選んだクリップの字幕だけに使います"}
              {captionTextStyleId
                ? "。文字スタイルを選んでいる間は、配色・見た目は文字スタイルのものになります(フォント・位置・大きさは効きます)"
                : ""}
            </span>
            {lookSettings}
          </Collapsible>
        </SettingsSection>

        {narrationSection}

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
