"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectBgm, ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { beginPointerDrag } from "./pointerDrag";
import {
  DEFAULT_PIXELS_PER_SECOND,
  clampPixelsPerSecond,
  formatTimecode,
  pickRulerStepSeconds,
  pixelsToSeconds,
  secondsToPixels,
} from "./timelineScale";
import { VideoTrack } from "./VideoTrack";
import { SfxTrack, BgmTrack } from "./AudioTracks";

type SelectModifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
export type AudioSelection = { kind: "sfx"; key: string } | { kind: "bgm" } | null;

type TimelineRootProps = {
  segments: ProjectSegment[];
  sfxClips: ProjectSfxClip[];
  bgm: ProjectBgm | null;
  videoPath: string;
  totalDurationSeconds: number;
  currentSeconds: number;
  selectedKeys: Set<string>;
  activeSegmentKey: string | null;
  audioSelection: AudioSelection;
  onSelectSegment: (key: string, index: number, modifiers: SelectModifiers) => void;
  onTrimStart: (key: string, desiredStartSeconds: number) => void;
  onTrimEnd: (key: string, desiredDurationSeconds: number) => void;
  onReorder: (draggedKey: string, targetKey: string) => void;
  onSelectSfx: (key: string) => void;
  onMoveSfx: (key: string, desiredStartSeconds: number) => void;
  onSelectBgm: () => void;
  onScrub: (seconds: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canAddSegment: boolean;
  onAddSegment: () => void;
  selectedCount: number;
  onDeleteSelected: () => void;
  onOpenBulkEdit: () => void;
  canOpenBulkEdit: boolean;
  canSplitAtPlayhead: boolean;
  onSplitAtPlayhead: () => void;
  /** 再生ヘッドが乗っているクリップのイン点/アウト点(開始/終了)を、その位置に打ち直す。 */
  onTrimStartToPlayhead: () => void;
  onTrimEndToPlayhead: () => void;
  /** ラフカット画面など、SE/BGMがまだ存在しない編集段階でトラック行自体を省く。 */
  hideAudioTracks?: boolean;
};

const RULER_HEIGHT = 28;

export const TimelineRoot: React.FC<TimelineRootProps> = ({
  segments,
  sfxClips,
  bgm,
  videoPath,
  totalDurationSeconds,
  currentSeconds,
  selectedKeys,
  activeSegmentKey,
  audioSelection,
  onSelectSegment,
  onTrimStart,
  onTrimEnd,
  onReorder,
  onSelectSfx,
  onMoveSfx,
  onSelectBgm,
  onScrub,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canAddSegment,
  onAddSegment,
  selectedCount,
  onDeleteSelected,
  onOpenBulkEdit,
  canOpenBulkEdit,
  canSplitAtPlayhead,
  onSplitAtPlayhead,
  onTrimStartToPlayhead,
  onTrimEndToPlayhead,
  hideAudioTracks = false,
}) => {
  const canTrimAtPlayhead = activeSegmentKey !== null;
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const scrollRef = useRef<HTMLDivElement>(null);

  const contentWidthPx = Math.max(1, secondsToPixels(Math.max(totalDurationSeconds, 1), pixelsPerSecond));
  const rulerStepSeconds = pickRulerStepSeconds(pixelsPerSecond);
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= totalDurationSeconds + rulerStepSeconds; t += rulerStepSeconds) arr.push(t);
    return arr;
  }, [totalDurationSeconds, rulerStepSeconds]);

  const playheadLeftPx = secondsToPixels(currentSeconds, pixelsPerSecond);

  // 再生ヘッドが表示範囲外に出たら、スクロール位置を追従させる(CapCut/iMovie的な「常に見える」挙動)。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const visibleLeft = el.scrollLeft;
    const visibleRight = visibleLeft + el.clientWidth;
    if (playheadLeftPx < visibleLeft || playheadLeftPx > visibleRight - 40) {
      el.scrollLeft = Math.max(0, playheadLeftPx - el.clientWidth / 2);
    }
  }, [playheadLeftPx]);

  const scrubAtClientX = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft;
    onScrub(Math.max(0, pixelsToSeconds(x, pixelsPerSecond)));
  };

  return (
    <div className="editor-timeline-wrap">
      <div className="editor-timeline-toolbar">
        <button type="button" className="editor-toolbar-btn" onClick={onAddSegment} disabled={!canAddSegment}>
          + クリップ
        </button>
        <button
          type="button"
          className="editor-toolbar-btn"
          onClick={onSplitAtPlayhead}
          disabled={!canSplitAtPlayhead}
          title="再生ヘッドの位置でクリップを分割します (S)"
        >
          ✂ 分割
        </button>
        <button
          type="button"
          className="editor-toolbar-btn"
          onClick={onTrimStartToPlayhead}
          disabled={!canTrimAtPlayhead}
          title="再生ヘッドの位置をクリップの開始点にします (I)"
        >
          [ イン点
        </button>
        <button
          type="button"
          className="editor-toolbar-btn"
          onClick={onTrimEndToPlayhead}
          disabled={!canTrimAtPlayhead}
          title="再生ヘッドの位置をクリップの終了点にします (O)"
        >
          アウト点 ]
        </button>
        <button type="button" className="editor-toolbar-btn" onClick={onOpenBulkEdit} disabled={!canOpenBulkEdit}>
          字幕を一括編集
        </button>
        <button type="button" className="editor-toolbar-btn" onClick={onUndo} disabled={!canUndo} title="元に戻す (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button type="button" className="editor-toolbar-btn" onClick={onRedo} disabled={!canRedo} title="やり直す (Ctrl/Cmd+Shift+Z)">
          ↷
        </button>
        {selectedCount > 0 ? (
          <button type="button" className="editor-toolbar-btn danger" onClick={onDeleteSelected}>
            選択を削除({selectedCount})
          </button>
        ) : null}
        <div className="editor-timeline-spacer" />
        <span className="editor-timecode">{formatTimecode(currentSeconds)} / {formatTimecode(totalDurationSeconds)}</span>
        <div className="editor-zoom-control">
          <button type="button" className="editor-toolbar-btn" onClick={() => setPixelsPerSecond((v) => clampPixelsPerSecond(v / 1.4))}>
            −
          </button>
          <input
            type="range"
            min={12}
            max={320}
            value={pixelsPerSecond}
            onChange={(e) => setPixelsPerSecond(clampPixelsPerSecond(Number(e.target.value)))}
          />
          <button type="button" className="editor-toolbar-btn" onClick={() => setPixelsPerSecond((v) => clampPixelsPerSecond(v * 1.4))}>
            +
          </button>
        </div>
      </div>

      <div className="editor-timeline-scroll" ref={scrollRef}>
        <div className="editor-timeline-content" style={{ width: contentWidthPx }}>
          <div
            className="editor-ruler"
            style={{ height: RULER_HEIGHT }}
            onPointerDown={(e) => {
              const startClientX = e.clientX;
              scrubAtClientX(startClientX);
              beginPointerDrag(e, { onMove: (dx) => scrubAtClientX(startClientX + dx) });
            }}
          >
            {ticks.map((t) => (
              <div key={t} className="editor-ruler-tick" style={{ left: secondsToPixels(t, pixelsPerSecond) }}>
                <span>{formatTimecode(t)}</span>
              </div>
            ))}
          </div>

          <div className="editor-tracks">
            <VideoTrack
              segments={segments}
              videoPath={videoPath}
              pixelsPerSecond={pixelsPerSecond}
              selectedKeys={selectedKeys}
              activeSegmentKey={activeSegmentKey}
              onSelect={onSelectSegment}
              onTrimStart={onTrimStart}
              onTrimEnd={onTrimEnd}
              onReorder={onReorder}
            />
            {hideAudioTracks ? null : (
              <>
                <SfxTrack
                  clips={sfxClips}
                  totalDurationSeconds={totalDurationSeconds}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedKey={audioSelection?.kind === "sfx" ? audioSelection.key : null}
                  onSelect={onSelectSfx}
                  onMove={onMoveSfx}
                />
                <BgmTrack
                  bgm={bgm}
                  totalDurationSeconds={totalDurationSeconds}
                  pixelsPerSecond={pixelsPerSecond}
                  isSelected={audioSelection?.kind === "bgm"}
                  onSelect={onSelectBgm}
                />
              </>
            )}
          </div>

          <div className="editor-playhead" style={{ left: playheadLeftPx }} />
        </div>
      </div>
    </div>
  );
};
