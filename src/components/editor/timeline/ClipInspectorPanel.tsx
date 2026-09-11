"use client";

import type { ProjectSegment } from "@/lib/videoProject";
import { canMergeWithNext } from "../timelineUtils";

type Props = {
  segments: ProjectSegment[];
  selectedSegmentKey: string | null;
  selectedCount: number;
  onUpdateSegment: (
    key: string,
    patch: Partial<Pick<ProjectSegment, "startFromSeconds" | "durationInSeconds" | "volume">>
  ) => void;
  onMergeWithNext: (key: string) => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
  onDeleteSelected: () => void;
};

/**
 * 「動画カット」タブの右側パネル。選択中クリップの尺・音量など、動画そのものの
 * 切り出しに関わるプロパティのみを扱う(テロップ・演出は「字幕」タブ、
 * SE/BGM/AIナレーションは各専用タブが担当)。
 */
export const ClipInspectorPanel: React.FC<Props> = ({
  segments,
  selectedSegmentKey,
  selectedCount,
  onUpdateSegment,
  onMergeWithNext,
  onDuplicate,
  onRemove,
  onDeleteSelected,
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
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              {selectedSegment.caption || "(テロップ無し)"}
            </p>
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
