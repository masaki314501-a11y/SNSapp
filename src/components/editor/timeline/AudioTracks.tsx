"use client";

import { beginPointerDrag } from "./pointerDrag";
import { pixelsToSeconds, secondsToPixels } from "./timelineScale";
import { useAudioWaveform } from "./useAudioWaveform";
import type { ProjectBgm, ProjectSfxClip } from "@/lib/videoProject";

const Waveform: React.FC<{ src: string; widthPx: number; heightPx: number }> = ({ src, widthPx, heightPx }) => {
  const bucketCount = Math.max(1, Math.round(widthPx / 2));
  const peaks = useAudioWaveform(src, bucketCount);
  if (peaks.length === 0) return null;
  const mid = heightPx / 2;
  const barWidth = widthPx / peaks.length;
  return (
    <svg className="editor-waveform" width={widthPx} height={heightPx} preserveAspectRatio="none">
      {peaks.map((peak, i) => {
        const h = Math.max(1, peak * heightPx);
        return <rect key={i} x={i * barWidth} y={mid - h / 2} width={Math.max(1, barWidth - 0.5)} height={h} />;
      })}
    </svg>
  );
};

type SfxTrackProps = {
  clips: ProjectSfxClip[];
  totalDurationSeconds: number;
  pixelsPerSecond: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onMove: (key: string, desiredStartSeconds: number) => void;
};

export const SfxTrack: React.FC<SfxTrackProps> = ({
  clips,
  totalDurationSeconds,
  pixelsPerSecond,
  selectedKey,
  onSelect,
  onMove,
}) => {
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, clip: ProjectSfxClip) => {
    const originalStart = clip.startFromSeconds;
    beginPointerDrag(e, {
      onMove: (dx) => onMove(clip.key, Math.max(0, originalStart + pixelsToSeconds(dx, pixelsPerSecond))),
      onClick: () => onSelect(clip.key),
    });
  };

  return (
    <div className="editor-track editor-track-sfx">
      <div className="editor-track-label">効果音</div>
      <div className="editor-lane" style={{ width: secondsToPixels(totalDurationSeconds, pixelsPerSecond) }}>
        {clips.map((clip) => {
          // SE単体の尺は不明(元ファイルの長さ)なので、波形が読み込まれるまでは既定幅で描画する。
          const widthPx = 96;
          const leftPx = secondsToPixels(clip.startFromSeconds, pixelsPerSecond);
          return (
            <div
              key={clip.key}
              className={`editor-clip-block sfx${selectedKey === clip.key ? " selected" : ""}`}
              style={{ left: leftPx, width: widthPx }}
              onPointerDown={(e) => handlePointerDown(e, clip)}
              title={clip.label}
            >
              <Waveform src={clip.src} widthPx={widthPx} heightPx={28} />
              <span className="editor-clip-caption">{clip.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

type BgmTrackProps = {
  bgm: ProjectBgm | null;
  totalDurationSeconds: number;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: () => void;
};

export const BgmTrack: React.FC<BgmTrackProps> = ({ bgm, totalDurationSeconds, pixelsPerSecond, isSelected, onSelect }) => {
  const widthPx = secondsToPixels(totalDurationSeconds, pixelsPerSecond);
  return (
    <div className="editor-track editor-track-bgm">
      <div className="editor-track-label">BGM</div>
      <div className="editor-lane" style={{ width: widthPx }}>
        {bgm ? (
          <div
            className={`editor-clip-block bgm${isSelected ? " selected" : ""}`}
            style={{ left: 0, width: Math.max(4, widthPx) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            title={bgm.label}
          >
            {bgm.fadeInSeconds > 0 ? (
              <div className="editor-clip-fade left" style={{ width: secondsToPixels(bgm.fadeInSeconds, pixelsPerSecond) }} />
            ) : null}
            {bgm.fadeOutSeconds > 0 ? (
              <div className="editor-clip-fade right" style={{ width: secondsToPixels(bgm.fadeOutSeconds, pixelsPerSecond) }} />
            ) : null}
            <Waveform src={bgm.src} widthPx={widthPx} heightPx={28} />
            <span className="editor-clip-caption">{bgm.label}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};
