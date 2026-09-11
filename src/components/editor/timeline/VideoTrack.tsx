"use client";

import { memo, useState } from "react";
import type { ProjectSegment } from "@/lib/videoProject";
import { beginPointerDrag } from "./pointerDrag";
import { pixelsToSeconds, secondsToPixels } from "./timelineScale";
import { useClipThumbnails } from "./useClipThumbnails";

type SelectModifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

type VideoClipBlockProps = {
  segment: ProjectSegment;
  index: number;
  leftSeconds: number;
  videoPath: string;
  pixelsPerSecond: number;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (key: string, index: number, modifiers: SelectModifiers) => void;
  onTrimStart: (key: string, desiredStartSeconds: number) => void;
  onTrimEnd: (key: string, desiredDurationSeconds: number) => void;
  onReorderDrop: (draggedKey: string, dropXPixels: number) => void;
};

/**
 * 動画トラック上の1クリップ。再生順で左から詰めて並ぶ(位置=leftSeconds)。
 * segment.startFromSecondsは「元動画の何秒目を使うか」であって画面上の位置ではないため、
 * サムネイル抽出の基準時刻としてのみ使う(位置には使わない)。
 */
const VideoClipBlock: React.FC<VideoClipBlockProps> = memo(function VideoClipBlock({
  segment,
  index,
  leftSeconds,
  videoPath,
  pixelsPerSecond,
  isSelected,
  isActive,
  onSelect,
  onTrimStart,
  onTrimEnd,
  onReorderDrop,
}) {
  const widthPx = Math.max(4, secondsToPixels(segment.durationInSeconds, pixelsPerSecond));
  const leftPx = secondsToPixels(leftSeconds, pixelsPerSecond);
  const thumbnails = useClipThumbnails(videoPath, segment.startFromSeconds, segment.durationInSeconds, widthPx);
  const [dragDeltaPx, setDragDeltaPx] = useState<number | null>(null);

  const handleBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const shiftKey = e.shiftKey;
    const ctrlKey = e.ctrlKey;
    const metaKey = e.metaKey;
    beginPointerDrag(e, {
      onStart: () => setDragDeltaPx(0),
      onMove: (dx) => setDragDeltaPx(dx),
      onEnd: (dx) => {
        setDragDeltaPx(null);
        onReorderDrop(segment.key, leftPx + dx + widthPx / 2);
      },
      onClick: () => onSelect(segment.key, index, { shiftKey, ctrlKey, metaKey }),
    });
  };

  const handleLeftHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const originalStart = segment.startFromSeconds;
    beginPointerDrag(e, {
      onMove: (dx) => onTrimStart(segment.key, originalStart + pixelsToSeconds(dx, pixelsPerSecond)),
    });
  };

  const handleRightHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const originalDuration = segment.durationInSeconds;
    beginPointerDrag(e, {
      onMove: (dx) => onTrimEnd(segment.key, originalDuration + pixelsToSeconds(dx, pixelsPerSecond)),
    });
  };

  return (
    <div
      className={`editor-clip-block video${isSelected ? " selected" : ""}${isActive ? " active" : ""}`}
      style={{
        left: leftPx,
        width: widthPx,
        transform: dragDeltaPx !== null ? `translateX(${dragDeltaPx}px)` : undefined,
        zIndex: dragDeltaPx !== null ? 20 : undefined,
      }}
      onPointerDown={handleBodyPointerDown}
      title={segment.caption || `クリップ${index + 1}`}
    >
      <div className="editor-clip-thumbs">
        {thumbnails.map((thumb, i) =>
          thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- キャンバス生成のdataURLをそのまま表示するため
            <img key={i} src={thumb} alt="" draggable={false} />
          ) : (
            <div key={i} className="editor-clip-thumb-placeholder" />
          )
        )}
      </div>
      <span className="editor-clip-caption">{segment.caption || "(無音)"}</span>
      <div className="editor-clip-handle left" onPointerDown={handleLeftHandlePointerDown} />
      <div className="editor-clip-handle right" onPointerDown={handleRightHandlePointerDown} />
    </div>
  );
});

type VideoTrackProps = {
  segments: ProjectSegment[];
  videoPath: string;
  pixelsPerSecond: number;
  selectedKeys: Set<string>;
  activeSegmentKey: string | null;
  onSelect: (key: string, index: number, modifiers: SelectModifiers) => void;
  onTrimStart: (key: string, desiredStartSeconds: number) => void;
  onTrimEnd: (key: string, desiredDurationSeconds: number) => void;
  onReorder: (draggedKey: string, targetKey: string) => void;
};

export const VideoTrack: React.FC<VideoTrackProps> = memo(function VideoTrack({
  segments,
  videoPath,
  pixelsPerSecond,
  selectedKeys,
  activeSegmentKey,
  onSelect,
  onTrimStart,
  onTrimEnd,
  onReorder,
}) {
  const positioned = segments.reduce<{ segment: ProjectSegment; leftSeconds: number }[]>((acc, segment) => {
    const prev = acc[acc.length - 1];
    const leftSeconds = prev ? prev.leftSeconds + prev.segment.durationInSeconds : 0;
    return [...acc, { segment, leftSeconds }];
  }, []);
  const totalSeconds = positioned.reduce(
    (sum, { segment }) => sum + segment.durationInSeconds,
    0
  );

  const handleReorderDrop = (draggedKey: string, dropXPixels: number) => {
    const target = positioned.find(({ segment, leftSeconds }) => {
      const leftPx = secondsToPixels(leftSeconds, pixelsPerSecond);
      const rightPx = leftPx + secondsToPixels(segment.durationInSeconds, pixelsPerSecond);
      return dropXPixels >= leftPx && dropXPixels < rightPx && segment.key !== draggedKey;
    });
    if (target) onReorder(draggedKey, target.segment.key);
  };

  return (
    <div className="editor-track editor-track-video">
      <div className="editor-track-label">映像</div>
      <div className="editor-lane" style={{ width: secondsToPixels(totalSeconds, pixelsPerSecond) }}>
        {positioned.map(({ segment, leftSeconds }, index) => (
          <VideoClipBlock
            key={segment.key}
            segment={segment}
            index={index}
            leftSeconds={leftSeconds}
            videoPath={videoPath}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedKeys.has(segment.key)}
            isActive={activeSegmentKey === segment.key}
            onSelect={onSelect}
            onTrimStart={onTrimStart}
            onTrimEnd={onTrimEnd}
            onReorderDrop={handleReorderDrop}
          />
        ))}
      </div>
    </div>
  );
});
