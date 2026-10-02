import { PauseIcon, PlayIcon, RedoIcon, UndoIcon } from "@/components/icons";
import { formatTimecode } from "./timeline/timelineScale";

type PlaybackBarProps = {
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentSeconds: number;
  totalSeconds: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** タブレット横向き・PCで、再生バーの中に並べる操作ボタン(ToolInline)。 */
  children?: React.ReactNode;
  className?: string;
};

/**
 * 動画のすぐ下に置く再生バー。Remotion Player標準のコントロールは動画の上に重なって
 * スマホでは字幕や演出を隠していたため使わず、再生・時刻・元に戻す/やり直すをここに集める。
 */
export const PlaybackBar: React.FC<PlaybackBarProps> = ({
  isPlaying,
  onTogglePlay,
  currentSeconds,
  totalSeconds,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  children,
  className,
}) => (
  <div className={`playback-bar${className ? ` ${className}` : ""}`}>
    <button
      type="button"
      className="playback-play"
      onClick={onTogglePlay}
      aria-label={isPlaying ? "一時停止" : "再生"}
    >
      {isPlaying ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
    </button>
    <span className="playback-time">
      {formatTimecode(currentSeconds)} <span>/ {formatTimecode(totalSeconds)}</span>
    </span>
    {children ? <div className="playback-tools">{children}</div> : null}
    <div className="playback-spacer" />
    <button type="button" className="topbar-icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="元に戻す">
      <UndoIcon />
    </button>
    <button type="button" className="topbar-icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="やり直す">
      <RedoIcon />
    </button>
  </div>
);
