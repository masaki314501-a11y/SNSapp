"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import { MAX_CLIPS } from "@video/templates/standard/schema";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, DEFAULT_CLIP_DURATION_IN_SECONDS } from "@video/shared/constants";
import {
  DEFAULT_CAPTION_ANIMATION,
  DEFAULT_CLIP_VOLUME,
  buildStandardVideoProps,
  clearProject,
  loadProject,
  saveProject,
  type ProjectSegment,
  type VideoProject,
} from "@/lib/videoProject";
import {
  MIN_SEGMENT_DURATION_IN_SECONDS,
  findLargestGap,
  clampTrimStart,
  clampTrimEnd,
  canSplitSegment,
  splitSegment,
  subtractSourceRange,
  keepOnlySourceRange,
} from "./timelineUtils";
import { TimelineRoot } from "./timeline/TimelineRoot";
import { beginPointerDrag } from "./timeline/pointerDrag";

/**
 * アップロード直後の動画から、実際に使う範囲だけを粗く選ぶラフカット画面(/create/cut)。
 * ここで捨てた範囲は以降(参考画像でのスタイル抽出・音声からの字幕生成)の対象にならないため、
 * 不要な前置き・言い淀み・撮り直し部分などを先に切り捨てておくと後工程が速く・安く済む。
 * テロップ・SE/BGM・スタイルはまだ持たず、クリップの分割・トリム・並べ替え・削除のみを扱う。
 */
const applyTrimPatch = (
  segments: ProjectSegment[],
  videoDurationInSeconds: number,
  key: string,
  patch: Partial<Pick<ProjectSegment, "startFromSeconds" | "durationInSeconds">>
): ProjectSegment[] => {
  const sortedByTime = [...segments].sort((a, b) => a.startFromSeconds - b.startFromSeconds);
  const sortedIndex = sortedByTime.findIndex((segment) => segment.key === key);
  if (sortedIndex === -1) return segments;

  let updated = sortedByTime[sortedIndex];
  if (patch.startFromSeconds !== undefined) {
    updated = { ...updated, ...clampTrimStart(sortedIndex, sortedByTime, patch.startFromSeconds) };
  }
  if (patch.durationInSeconds !== undefined) {
    updated = {
      ...updated,
      durationInSeconds: clampTrimEnd(sortedIndex, sortedByTime, videoDurationInSeconds, patch.durationInSeconds),
    };
  }
  return segments.map((segment) => (segment.key === key ? updated : segment));
};

const EmptyState: React.FC = () => (
  <div className="panel flex flex-col items-center gap-3 p-10 text-center">
    <p className="text-sm font-medium">カットする動画がありません</p>
    <p className="text-xs" style={{ color: "var(--muted-2)" }}>
      まずは動画をアップロードしてください
    </p>
    <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
      動画をアップロードする →
    </a>
  </div>
);

export const CutEditor: React.FC = () => {
  const router = useRouter();
  const playerRef = useRef<PlayerRef>(null);

  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);
  const [segments, setSegments] = useState<ProjectSegment[]>([]);
  const [history, setHistory] = useState<ProjectSegment[][]>([]);
  const [future, setFuture] = useState<ProjectSegment[][]>([]);
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  /** 元動画バー上でドラッグして選んだ範囲(元動画上の秒)。捨てる/ここだけ残すの対象。 */
  const [sourceRange, setSourceRange] = useState<{ start: number; end: number } | null>(null);
  const coverageBarRef = useRef<HTMLDivElement>(null);

  const videoDurationInSeconds = project?.videoDurationInSeconds ?? 0;

  useEffect(() => {
    const loaded = loadProject();
    if (loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
      setProject(loaded);
      setSegments(loaded.segments);
    }
    setHasCheckedProject(true);
  }, []);

  // 自動保存(カット結果は/create/styleへ渡す前提の一時状態だが、リロードしても続けられるようにする)。
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      saveProject({ ...project, segments });
    }, 500);
    return () => clearTimeout(timer);
  }, [project, segments]);

  const props = useMemo(
    () =>
      buildStandardVideoProps({
        videoPath: project?.videoPath ?? "",
        segments,
        primaryColor: project?.primaryColor ?? "#FF3366",
        captionStyle: project?.captionStyle ?? "pill",
        fontFamily: project?.fontFamily ?? "Noto Sans JP",
        captionPosition: project?.captionPosition ?? "bottom",
        fontSize: project?.fontSize ?? "medium",
        fadeInOut: false,
        sfxClips: [],
        bgm: null,
      }),
    [segments, project]
  );
  const durationInFrames = useMemo(() => getStandardVideoDurationInFrames(props), [props]);

  const [previewFrame, setPreviewFrame] = useState(0);
  const hasClips = segments.length > 0;
  useEffect(() => {
    if (!hasClips) return;
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = ({ detail }: { detail: { frame: number } }) => {
      setPreviewFrame(detail.frame);
    };
    player.addEventListener("frameupdate", handleFrameUpdate);
    return () => player.removeEventListener("frameupdate", handleFrameUpdate);
  }, [hasClips]);

  const segmentFrameRanges = useMemo(
    () =>
      segments.reduce<{ key: string; startFrame: number; endFrame: number }[]>((acc, segment) => {
        const startFrame = acc.length > 0 ? acc[acc.length - 1].endFrame : 0;
        const endFrame = startFrame + Math.round(segment.durationInSeconds * VIDEO_FPS);
        return [...acc, { key: segment.key, startFrame, endFrame }];
      }, []),
    [segments]
  );
  const activeProgramSegment = useMemo(() => {
    const current =
      segmentFrameRanges.find((range) => previewFrame < range.endFrame) ??
      segmentFrameRanges[segmentFrameRanges.length - 1];
    if (!current) return null;
    return { key: current.key, offsetSeconds: (previewFrame - current.startFrame) / VIDEO_FPS };
  }, [segmentFrameRanges, previewFrame]);
  const activeSegmentKey = activeProgramSegment?.key ?? null;

  const largestGap = useMemo(() => findLargestGap(segments, videoDurationInSeconds), [segments, videoDurationInSeconds]);
  const canAddSegment = segments.length < MAX_CLIPS && largestGap !== null;
  const canRemoveSegment = segments.length > 0;

  const totalSeconds = useMemo(
    () => segments.reduce((sum, segment) => sum + segment.durationInSeconds, 0),
    [segments]
  );

  /**
   * 元動画のどこを残し、どこを捨てたかを可視化するための、元動画全体を基準にした
   * 「使う範囲」の一覧(再生順ではなく元動画上の時刻順にマージ)。
   * クリップ一覧(VideoTrack)は再生順に詰めて表示するため、元動画のどこを切ったかは
   * ここで別に見せないと分からない。
   */
  const sourceCoverage = useMemo(() => {
    if (videoDurationInSeconds <= 0) return { ranges: [] as [number, number][], keptSeconds: 0 };
    const sorted = segments
      .map((s): [number, number] => [s.startFromSeconds, s.startFromSeconds + s.durationInSeconds])
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [start, end] of sorted) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1] + 0.01) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }
    const keptSeconds = merged.reduce((sum, [start, end]) => sum + (end - start), 0);
    return { ranges: merged, keptSeconds };
  }, [segments, videoDurationInSeconds]);

  /** 再生ヘッドが今どのクリップの何秒目かを、元動画上の時刻に変換する(上のバーの再生位置表示用)。 */
  const activeSourceSeconds = useMemo(() => {
    if (!activeProgramSegment) return null;
    const segment = segments.find((s) => s.key === activeProgramSegment.key);
    if (!segment) return null;
    return segment.startFromSeconds + activeProgramSegment.offsetSeconds;
  }, [activeProgramSegment, segments]);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev, segments].slice(-50));
    setFuture([]);
  }, [segments]);

  const selectOnly = useCallback((key: string | null) => {
    setSelectedSegmentKey(key);
    setSelectedKeys(key ? new Set([key]) : new Set());
  }, []);

  const undo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setFuture((f) => [segments, ...f]);
      setSegments(last);
      selectOnly(null);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setHistory((h) => [...h, segments]);
      setSegments(next);
      selectOnly(null);
      return prev.slice(1);
    });
  };

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  const updateSegmentTrim = useCallback(
    (key: string, patch: Partial<Pick<ProjectSegment, "startFromSeconds" | "durationInSeconds">>) => {
      setSegments((prev) => applyTrimPatch(prev, videoDurationInSeconds, key, patch));
    },
    [videoDurationInSeconds]
  );
  const handleTrimStart = useCallback(
    (key: string, value: number) => updateSegmentTrim(key, { startFromSeconds: value }),
    [updateSegmentTrim]
  );
  const handleTrimEnd = useCallback(
    (key: string, value: number) => updateSegmentTrim(key, { durationInSeconds: value }),
    [updateSegmentTrim]
  );

  const addSegment = () => {
    if (!canAddSegment || !largestGap) return;
    const durationInSeconds = Math.min(
      Math.max(Math.min(DEFAULT_CLIP_DURATION_IN_SECONDS, largestGap.size), MIN_SEGMENT_DURATION_IN_SECONDS),
      largestGap.size
    );
    const newSegment: ProjectSegment = {
      key: crypto.randomUUID(),
      caption: "",
      startFromSeconds: largestGap.start,
      durationInSeconds,
      captionAnimation: DEFAULT_CAPTION_ANIMATION,
      volume: DEFAULT_CLIP_VOLUME,
    };
    pushHistory();
    setSegments((prev) => [...prev, newSegment]);
    selectOnly(newSegment.key);
  };

  const removeSegments = (keys: Set<string>) => {
    if (keys.size === 0 || !canRemoveSegment) return;
    pushHistory();
    setSegments((prev) => prev.filter((segment) => !keys.has(segment.key)));
    selectOnly(null);
  };

  const reorderSegment = useCallback((draggedKey: string, targetKey: string) => {
    if (draggedKey === targetKey) return;
    if (!segments.some((s) => s.key === draggedKey) || !segments.some((s) => s.key === targetKey)) return;
    pushHistory();
    setSegments((prev) => {
      const next = [...prev];
      const fromIndex = next.findIndex((segment) => segment.key === draggedKey);
      const toIndex = next.findIndex((segment) => segment.key === targetKey);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [segments, pushHistory]);

  const canSplitAtPlayhead = useMemo(() => {
    if (!activeProgramSegment || segments.length >= MAX_CLIPS) return false;
    const segment = segments.find((s) => s.key === activeProgramSegment.key);
    if (!segment) return false;
    return canSplitSegment(segment, activeProgramSegment.offsetSeconds);
  }, [activeProgramSegment, segments]);

  const splitAtPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    setSegments((prev) => {
      const index = prev.findIndex((segment) => segment.key === key);
      if (index === -1 || prev.length >= MAX_CLIPS) return prev;
      const segment = prev[index];
      if (!canSplitSegment(segment, offsetSeconds)) return prev;
      pushHistory();
      const newKey = crypto.randomUUID();
      return splitSegment(prev, index, offsetSeconds, newKey);
    });
  };

  /** 今プレビューが再生している範囲の開始点(イン点)を、再生ヘッドの位置に打ち直す。 */
  const trimStartToPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    const segment = segments.find((s) => s.key === key);
    if (!segment) return;
    pushHistory();
    updateSegmentTrim(key, { startFromSeconds: segment.startFromSeconds + offsetSeconds });
  };

  /** 今プレビューが再生している範囲の終了点(アウト点)を、再生ヘッドの位置に打ち直す。 */
  const trimEndToPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    pushHistory();
    updateSegmentTrim(key, { durationInSeconds: offsetSeconds });
  };

  /**
   * 元動画上の時刻を、プレビュー(再生順に詰めた尺)上のフレームに直してシークする。
   * 捨てた範囲を指した場合はその直後に残っているクリップの先頭へ寄せる。
   */
  const seekToSourceSeconds = (sourceSeconds: number) => {
    let elapsed = 0;
    let fallbackFrame: number | null = null;
    for (const segment of segments) {
      const segEnd = segment.startFromSeconds + segment.durationInSeconds;
      if (sourceSeconds >= segment.startFromSeconds && sourceSeconds < segEnd) {
        playerRef.current?.seekTo(Math.round((elapsed + sourceSeconds - segment.startFromSeconds) * VIDEO_FPS));
        return;
      }
      if (fallbackFrame === null && segment.startFromSeconds >= sourceSeconds) {
        fallbackFrame = Math.round(elapsed * VIDEO_FPS);
      }
      elapsed += segment.durationInSeconds;
    }
    playerRef.current?.seekTo(fallbackFrame ?? Math.max(0, Math.round(elapsed * VIDEO_FPS) - 1));
  };

  const sourceSecondsAtClientX = (clientX: number): number => {
    const rect = coverageBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(Math.max(ratio, 0), 1) * videoDurationInSeconds;
  };

  /**
   * 元動画バーの操作。クリックならその時刻へシーク、横にドラッグしたなら範囲選択。
   * 「元動画のどこを捨てたか」を見せているバーの上でそのまま範囲を指定できるようにすることで、
   * 分割→分割→選択→削除の4手を1手にする。
   */
  const handleCoveragePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (videoDurationInSeconds <= 0) return;
    const anchorSeconds = sourceSecondsAtClientX(e.clientX);
    const startClientX = e.clientX;
    beginPointerDrag(e, {
      onMove: (dx) => {
        const current = sourceSecondsAtClientX(startClientX + dx);
        setSourceRange({ start: Math.min(anchorSeconds, current), end: Math.max(anchorSeconds, current) });
      },
      onClick: () => {
        setSourceRange(null);
        seekToSourceSeconds(anchorSeconds);
      },
    });
  };

  const applySourceRange = (mode: "discard" | "keepOnly") => {
    if (!sourceRange) return;
    const next =
      mode === "discard"
        ? subtractSourceRange(segments, sourceRange.start, sourceRange.end, () => crypto.randomUUID())
        : keepOnlySourceRange(segments, sourceRange.start, sourceRange.end);
    if (next.length === 0) {
      alert("その範囲を適用すると使うクリップが無くなってしまうため、実行できません");
      return;
    }
    pushHistory();
    setSegments(next);
    setSourceRange(null);
    selectOnly(null);
  };

  const selectSegment = useCallback((
    key: string,
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ) => {
    if (modifiers.shiftKey && selectedSegmentKey) {
      const anchorIndex = segments.findIndex((segment) => segment.key === selectedSegmentKey);
      if (anchorIndex !== -1) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        setSelectedKeys(new Set(segments.slice(from, to + 1).map((segment) => segment.key)));
        return;
      }
    }
    if (modifiers.metaKey || modifiers.ctrlKey) {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setSelectedSegmentKey(key);
      return;
    }
    selectOnly(key);
    // 分割・イン/アウト点は再生ヘッドの位置にあるクリップに対して働くため、クリックした
    // クリップと再生ヘッドがずれたままだと「選んだのに違うクリップが編集される」ことになる。
    // クリック時に再生ヘッドをそのクリップの先頭へ合わせ、選択=編集対象を一致させる。
    const range = segmentFrameRanges.find((r) => r.key === key);
    if (range) playerRef.current?.seekTo(range.startFrame);
  }, [selectedSegmentKey, segments, segmentFrameRanges, selectOnly]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      const isFocusedControl = target instanceof HTMLButtonElement || target instanceof HTMLSelectElement;
      const isRedoCombo =
        (e.metaKey || e.ctrlKey) && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y");
      const isUndoCombo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z";

      if (isRedoCombo) {
        e.preventDefault();
        redo();
        return;
      }
      if (isUndoCombo) {
        e.preventDefault();
        undo();
        return;
      }
      if (isEditableTarget) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedKeys.size > 0) {
        e.preventDefault();
        removeSegments(selectedKeys);
        return;
      }
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey && canSplitAtPlayhead) {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (e.key.toLowerCase() === "i" && !e.metaKey && !e.ctrlKey && activeSegmentKey) {
        e.preventDefault();
        trimStartToPlayhead();
        return;
      }
      if (e.key.toLowerCase() === "o" && !e.metaKey && !e.ctrlKey && activeSegmentKey) {
        e.preventDefault();
        trimEndToPlayhead();
        return;
      }
      if (isFocusedControl) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        playerRef.current?.toggle();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const player = playerRef.current;
        if (!player) return;
        e.preventDefault();
        // 1フレーム送りだけだと数十秒の動画でも切り所を探すのに時間がかかるため、
        // Shift併用で1秒単位の粗送りにする。
        const step = e.shiftKey ? VIDEO_FPS : 1;
        const delta = e.key === "ArrowLeft" ? -step : step;
        player.seekTo(Math.max(0, player.getCurrentFrame() + delta));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleStartOver = () => {
    if (!window.confirm("現在の内容を破棄して、新しい動画のアップロードからやり直しますか?")) return;
    clearProject();
    router.push("/create");
  };

  const handleGoToStyle = () => {
    if (!project || segments.length === 0) return;
    saveProject({ ...project, segments });
    router.push("/create/style");
  };

  if (!hasCheckedProject) return null;
  if (!project) return <EmptyState />;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <button type="button" onClick={handleStartOver} className="btn-ghost self-start text-xs">
        ← 別の動画からやり直す
      </button>

      <div
        style={{
          height: "min(58vh, 620px)",
          aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}`,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border-strong)",
          alignSelf: "center",
        }}
      >
        <Player
          ref={playerRef}
          component={StandardVideo}
          inputProps={props}
          durationInFrames={Math.max(durationInFrames, 1)}
          fps={VIDEO_FPS}
          compositionWidth={VIDEO_WIDTH}
          compositionHeight={VIDEO_HEIGHT}
          style={{ width: "100%", height: "100%" }}
          controls
          loop
        />
      </div>
      <p className="text-center text-xs" style={{ color: "var(--muted-2)" }}>
        Space=再生/一時停止・←→=1フレーム送り(Shift+←→=1秒)・S=分割・I/O=再生位置をイン/アウト点に・Delete=選択を削除
      </p>

      {videoDurationInSeconds > 0 ? (
        <div className="editor-coverage-wrap">
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted-2)" }}>
            <span>元動画のうち、使う範囲(オレンジ)</span>
            <span>
              使用 {sourceCoverage.keptSeconds.toFixed(1)}秒 / 全体 {videoDurationInSeconds.toFixed(1)}秒
              (
              {Math.round((1 - sourceCoverage.keptSeconds / videoDurationInSeconds) * 100)}
              %カット)
            </span>
          </div>
          <div
            className="editor-coverage-bar"
            ref={coverageBarRef}
            onPointerDown={handleCoveragePointerDown}
            style={{ cursor: "text" }}
            title="クリックでその位置へ移動、横にドラッグで範囲を選択"
          >
            {sourceCoverage.ranges.map(([start, end], i) => (
              <div
                key={i}
                className="editor-coverage-kept"
                style={{
                  left: `${(start / videoDurationInSeconds) * 100}%`,
                  width: `${((end - start) / videoDurationInSeconds) * 100}%`,
                }}
              />
            ))}
            {sourceRange ? (
              <div
                className="editor-coverage-selection"
                style={{
                  left: `${(sourceRange.start / videoDurationInSeconds) * 100}%`,
                  width: `${((sourceRange.end - sourceRange.start) / videoDurationInSeconds) * 100}%`,
                }}
              />
            ) : null}
            {activeSourceSeconds !== null ? (
              <div
                className="editor-coverage-playhead"
                style={{ left: `${(activeSourceSeconds / videoDurationInSeconds) * 100}%` }}
              />
            ) : null}
          </div>
          {sourceRange ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                選択範囲 {sourceRange.start.toFixed(1)}秒 〜 {sourceRange.end.toFixed(1)}秒
                ({(sourceRange.end - sourceRange.start).toFixed(1)}秒)
              </span>
              <button type="button" className="editor-toolbar-btn danger" onClick={() => applySourceRange("discard")}>
                この範囲を捨てる
              </button>
              <button type="button" className="editor-toolbar-btn" onClick={() => applySourceRange("keepOnly")}>
                ここだけ残す
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setSourceRange(null)}>
                選択解除
              </button>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              バーをクリックでその位置へ移動・横にドラッグで範囲を選ぶと、まとめて捨てられます
            </p>
          )}
        </div>
      ) : null}

      <TimelineRoot
        segments={segments}
        sfxClips={[]}
        bgm={null}
        videoPath={project.videoPath}
        totalDurationSeconds={totalSeconds}
        currentSeconds={previewFrame / VIDEO_FPS}
        selectedKeys={selectedKeys}
        activeSegmentKey={activeSegmentKey}
        audioSelection={null}
        onSelectSegment={selectSegment}
        onTrimStart={handleTrimStart}
        onTrimEnd={handleTrimEnd}
        onTrimBegin={pushHistory}
        onReorder={reorderSegment}
        onSelectSfx={() => {}}
        onMoveSfx={() => {}}
        onSelectBgm={() => {}}
        onScrub={(seconds) => playerRef.current?.seekTo(Math.round(seconds * VIDEO_FPS))}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        canAddSegment={canAddSegment}
        onAddSegment={addSegment}
        selectedCount={selectedKeys.size}
        onDeleteSelected={() => removeSegments(selectedKeys)}
        canSplitAtPlayhead={canSplitAtPlayhead}
        onSplitAtPlayhead={splitAtPlayhead}
        onTrimStartToPlayhead={trimStartToPlayhead}
        onTrimEndToPlayhead={trimEndToPlayhead}
        tracks={{ sfx: false, bgm: false }}
      />

      <button
        type="button"
        onClick={handleGoToStyle}
        disabled={segments.length === 0}
        className="btn-primary flex h-14 items-center justify-center px-6 text-base"
      >
        この範囲で進む(参考画像・字幕生成へ) →
      </button>
    </div>
  );
};
