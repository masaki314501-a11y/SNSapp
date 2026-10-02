"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectBgm, ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import { beginPointerDrag, cancelActivePointerDrags } from "./pointerDrag";
import {
  DEFAULT_PIXELS_PER_SECOND,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  clampPixelsPerSecond,
  fitPixelsPerSecond,
  formatTimecode,
  pickRulerStepSeconds,
  pinchPixelsPerSecond,
  pixelsToSeconds,
  secondsToPixels,
} from "./timelineScale";
import { VideoTrack } from "./VideoTrack";
import { SfxTrack, BgmTrack } from "./AudioTracks";

type SelectModifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
export type AudioSelection = { kind: "sfx"; key: string } | { kind: "bgm" } | null;

/**
 * 分割・イン点/アウト点・元に戻す等の操作ボタンは、画面ごとの配置に合わせて呼び出し側
 * (ToolButtons.tsx・PlaybackBar.tsx)に置く。ここはルーラー・トラック・拡大縮小だけを持つ。
 */
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
  /** トリムのドラッグ開始時に1回だけ呼ばれる(Undo履歴をドラッグ単位で積むため)。 */
  onTrimBegin: () => void;
  onReorder: (draggedKey: string, targetKey: string) => void;
  onSelectSfx: (key: string) => void;
  onMoveSfx: (key: string, desiredStartSeconds: number) => void;
  onSelectBgm: () => void;
  onScrub: (seconds: number) => void;
  /**
   * どのトラックを表示するか(タブごとに今やりたいこと以外のトラックは隠す)。
   * 省略時は全トラック表示(ラフカット画面等、値を明示的に渡さない呼び出し向けの既定値)。
   */
  tracks?: { video?: boolean; sfx?: boolean; bgm?: boolean };
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
  onTrimBegin,
  onReorder,
  onSelectSfx,
  onMoveSfx,
  onSelectBgm,
  onScrub,
  tracks,
}) => {
  const showVideoTrack = tracks?.video ?? true;
  const showSfxTrack = tracks?.sfx ?? true;
  const showBgmTrack = tracks?.bgm ?? true;
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 最初は動画全体が見える幅に収める。利用者が拡大縮小した後は、その倍率を尊重して勝手に戻さない。
  // クリップの追加・削除等で長さが変わった時も合わせ直すが、指やマウスで操作している最中は
  // 合わせ直さない(トリムのドラッグ中に倍率が変わると、クリップが指から逃げるため)。離した時にまとめて行う。
  const userZoomedRef = useRef(false);
  const durationRef = useRef(totalDurationSeconds);
  const activePointersRef = useRef(new Set<number>());
  const refitPendingRef = useRef(false);

  const fitToWidth = () => {
    const el = scrollRef.current;
    if (!el) return;
    const labelWidth = el.querySelector<HTMLElement>(".editor-track-label")?.offsetWidth ?? 0;
    setPixelsPerSecond(fitPixelsPerSecond(el.clientWidth - labelWidth, durationRef.current));
  };

  useEffect(() => {
    durationRef.current = totalDurationSeconds;
    if (userZoomedRef.current) return;
    if (activePointersRef.current.size > 0) {
      refitPendingRef.current = true;
      return;
    }
    fitToWidth();
    // 長さが変わった時だけ合わせ直す
  }, [totalDurationSeconds]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleResize = () => {
      if (!userZoomedRef.current) fitToWidth();
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    observer.observe(el);
    return () => observer.disconnect();
    // 表示時と幅の変化時だけ合わせる(理由は上のコメント)
  }, []);

  const zoomTo = (next: number) => {
    userZoomedRef.current = true;
    setPixelsPerSecond(clampPixelsPerSecond(next));
  };

  const showWholeTimeline = () => {
    userZoomedRef.current = false;
    fitToWidth();
  };

  // 2本指のピンチで拡大縮小する。指の位置は子要素(クリップ等)に届いたイベントも含めて
  // 捕捉段階で拾う(クリップ側がsetPointerCaptureしていても、親には伝わってくる)。
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDistance: number; startPixelsPerSecond: number } | null>(null);
  const pointDistance = () => {
    const [a, b] = [...touchPointsRef.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const handleTouchPointerDown = (e: React.PointerEvent) => {
    activePointersRef.current.add(e.pointerId);
    if (e.pointerType !== "touch") return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPointsRef.current.size >= 2) {
      // 2本目以降の指ではクリップ等のドラッグを始めさせず、1本目で始まっていたドラッグ
      // (並べ替え・トリム・再生位置の移動)は確定させずに元へ戻す。ピンチは拡大縮小だけにする。
      e.stopPropagation();
      cancelActivePointerDrags();
      if (!pinchRef.current) {
        pinchRef.current = { startDistance: pointDistance(), startPixelsPerSecond: pixelsPerSecond };
      }
    }
  };
  const handleTouchPointerMove = (e: React.PointerEvent) => {
    if (!touchPointsRef.current.has(e.pointerId)) return;
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch && touchPointsRef.current.size === 2) {
      zoomTo(pinchPixelsPerSecond(pinch.startPixelsPerSecond, pinch.startDistance, pointDistance()));
    }
  };
  const handleTouchPointerEnd = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    touchPointsRef.current.delete(e.pointerId);
    if (touchPointsRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0 && refitPendingRef.current) {
      refitPendingRef.current = false;
      if (!userZoomedRef.current) fitToWidth();
    }
  };

  const contentWidthPx = Math.max(1, secondsToPixels(Math.max(totalDurationSeconds, 1), pixelsPerSecond));
  const rulerStepSeconds = pickRulerStepSeconds(pixelsPerSecond);
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= totalDurationSeconds; t += rulerStepSeconds) arr.push(t);
    return arr;
  }, [totalDurationSeconds, rulerStepSeconds]);

  // ルーラーと再生位置の線は、各トラックの左端にあるトラック名の列(.editor-track-label)の分だけ
  // 右にずらして、クリップと同じ位置に揃える(以前は列の幅だけクリップより左にずれていた)。
  const playheadLeftPx = secondsToPixels(currentSeconds, pixelsPerSecond);
  const rulerRef = useRef<HTMLDivElement>(null);

  // 再生ヘッドが表示範囲外に出たら、スクロール位置を追従させる(CapCut/iMovie的な「常に見える」挙動)。
  useEffect(() => {
    const el = scrollRef.current;
    const ruler = rulerRef.current;
    if (!el || !ruler) return;
    const playheadInScrollPx = ruler.offsetLeft + playheadLeftPx;
    const visibleLeft = el.scrollLeft + ruler.offsetLeft;
    const visibleRight = el.scrollLeft + el.clientWidth;
    if (playheadInScrollPx < visibleLeft || playheadInScrollPx > visibleRight - 40) {
      el.scrollLeft = Math.max(0, playheadInScrollPx - el.clientWidth / 2);
    }
  }, [playheadLeftPx]);

  const scrubAtClientX = (clientX: number) => {
    const ruler = rulerRef.current;
    if (!ruler) return;
    const x = clientX - ruler.getBoundingClientRect().left;
    onScrub(Math.max(0, pixelsToSeconds(x, pixelsPerSecond)));
  };

  return (
    <div className="editor-timeline-wrap">
      <div
        className="editor-timeline-scroll"
        ref={scrollRef}
        onPointerDownCapture={handleTouchPointerDown}
        onPointerMoveCapture={handleTouchPointerMove}
        onPointerUpCapture={handleTouchPointerEnd}
        onPointerCancelCapture={handleTouchPointerEnd}
      >
        <div
          className="editor-timeline-content"
          style={{ width: `calc(var(--track-label-width) + ${contentWidthPx}px)` }}
        >
          <div
            ref={rulerRef}
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
            {showVideoTrack ? (
              <VideoTrack
                segments={segments}
                videoPath={videoPath}
                pixelsPerSecond={pixelsPerSecond}
                selectedKeys={selectedKeys}
                activeSegmentKey={activeSegmentKey}
                onSelect={onSelectSegment}
                onTrimStart={onTrimStart}
                onTrimEnd={onTrimEnd}
                onTrimBegin={onTrimBegin}
                onReorder={onReorder}
              />
            ) : null}
            {showSfxTrack ? (
              <SfxTrack
                clips={sfxClips}
                totalDurationSeconds={totalDurationSeconds}
                pixelsPerSecond={pixelsPerSecond}
                selectedKey={audioSelection?.kind === "sfx" ? audioSelection.key : null}
                onSelect={onSelectSfx}
                onMove={onMoveSfx}
              />
            ) : null}
            {showBgmTrack ? (
              <BgmTrack
                bgm={bgm}
                totalDurationSeconds={totalDurationSeconds}
                pixelsPerSecond={pixelsPerSecond}
                isSelected={audioSelection?.kind === "bgm"}
                onSelect={onSelectBgm}
              />
            ) : null}
          </div>

          <div className="editor-playhead" style={{ left: `calc(var(--track-label-width) + ${playheadLeftPx}px)` }} />
        </div>
      </div>

      <div className="editor-timeline-zoom">
        <span className="editor-timeline-zoom-hint">2本の指で広げると拡大</span>
        <button type="button" className="editor-zoom-btn" onClick={showWholeTimeline}>
          全体
        </button>
        <button
          type="button"
          className="editor-zoom-btn"
          aria-label="縮小"
          onClick={() => zoomTo(pixelsPerSecond / 1.4)}
        >
          −
        </button>
        <input
          type="range"
          className="editor-zoom-range"
          aria-label="拡大率"
          min={MIN_PIXELS_PER_SECOND}
          max={MAX_PIXELS_PER_SECOND}
          value={pixelsPerSecond}
          onChange={(e) => zoomTo(Number(e.target.value))}
        />
        <button
          type="button"
          className="editor-zoom-btn"
          aria-label="拡大"
          onClick={() => zoomTo(pixelsPerSecond * 1.4)}
        >
          ＋
        </button>
      </div>
    </div>
  );
};
