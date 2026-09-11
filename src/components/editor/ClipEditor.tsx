"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { StandardVideo } from "@video/templates/standard/StandardVideo";
import { getStandardVideoDurationInFrames } from "@video/templates/standard/duration";
import { MIN_CLIPS, MAX_CLIPS, MAX_SFX_CLIPS } from "@video/templates/standard/schema";
import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, DEFAULT_CLIP_DURATION_IN_SECONDS } from "@video/shared/constants";
import {
  CAPTION_FONT_FAMILY_OPTIONS,
  CAPTION_FONT_SIZE_OPTIONS,
  CAPTION_POSITION_OPTIONS,
  CAPTION_STYLE_OPTIONS,
  type CaptionAnimation,
  type CaptionFontFamily,
  type CaptionFontSize,
  type CaptionPosition,
  type CaptionStyle,
} from "@video/shared/schema";
import {
  DEFAULT_CAPTION_ANIMATION,
  DEFAULT_CLIP_VOLUME,
  buildStandardVideoProps,
  clearProject,
  loadProject,
  parseProjectJson,
  saveProject,
  type ProjectBgm,
  type ProjectSegment,
  type ProjectSfxClip,
  type VideoProject,
} from "@/lib/videoProject";
import { uploadAudioFile } from "./uploadAudioFile";
import { requestVoiceover } from "./requestVoiceover";
import { STYLE_PRESETS, type StylePreset } from "./stylePresets";
import { SFX_PRESETS, BGM_PRESETS, type AudioPreset } from "./audioPresets";
import { VOICE_OPTIONS, DEFAULT_VOICE_NAME } from "@/lib/gemini/voiceOptions";
import {
  MIN_SEGMENT_DURATION_IN_SECONDS,
  findLargestGap,
  clampTrimStart,
  clampTrimEnd,
  canMergeWithNext,
  mergeWithNext,
  canSplitSegment,
  splitSegment,
} from "./timelineUtils";
import { TimelineRoot, type AudioSelection } from "./timeline/TimelineRoot";
import { ClipInspectorPanel } from "./timeline/ClipInspectorPanel";
import { CaptionInspectorPanel } from "./timeline/CaptionInspectorPanel";
import { SfxInspectorPanel } from "./timeline/SfxInspectorPanel";
import { NarrationInspectorPanel } from "./timeline/NarrationInspectorPanel";
import { BgmInspectorPanel } from "./timeline/BgmInspectorPanel";

/**
 * /create でアップロード・字幕生成された動画を、再生しながらトリム・並べ替え・
 * 文言修正・SE/BGM追加をして書き出す編集画面。/create からのlocalStorage経由の受け渡し
 * (videoProject.ts)を前提にしており、直接このページを開いてプロジェクトが無い場合は
 * /create への導線を表示する。
 */
type SegmentFormState = ProjectSegment;

type FormState = {
  segments: SegmentFormState[];
};

/**
 * クリップの位置(startFromSeconds)またはduration編集を、隣接クリップとの重なり防止・
 * 動画範囲内へのクランプを適用した上で反映する。クランプの基準(隣接クリップ)は元動画上の
 * 時刻順で求めるが、返す配列自体の並び順(=再生順)は変更前の並びをそのまま保つ
 * (トリム操作で再生順が勝手に入れ替わらないようにするため)。
 */
const applySegmentPatch = (
  segments: SegmentFormState[],
  videoDurationInSeconds: number,
  key: string,
  patch: Partial<
    Pick<SegmentFormState, "caption" | "startFromSeconds" | "durationInSeconds" | "captionAnimation" | "volume">
  >
): SegmentFormState[] => {
  if (patch.startFromSeconds === undefined && patch.durationInSeconds === undefined) {
    return segments.map((segment) => (segment.key === key ? { ...segment, ...patch } : segment));
  }
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
  if (patch.caption !== undefined) {
    updated = { ...updated, caption: patch.caption };
  }
  if (patch.captionAnimation !== undefined) {
    updated = { ...updated, captionAnimation: patch.captionAnimation };
  }
  if (patch.volume !== undefined) {
    updated = { ...updated, volume: patch.volume };
  }
  return segments.map((segment) => (segment.key === key ? updated : segment));
};

const EmptyState: React.FC = () => (
  <div className="panel flex flex-col items-center gap-3 p-10 text-center">
    <p className="text-sm font-medium">編集する動画がありません</p>
    <p className="text-xs" style={{ color: "var(--muted-2)" }}>
      まずは動画をアップロードして字幕を生成してください
    </p>
    <a href="/create" className="btn-primary px-4 py-1.5 text-sm">
      動画をアップロードする →
    </a>
  </div>
);

export const ClipEditor: React.FC = () => {
  const router = useRouter();
  const playerRef = useRef<PlayerRef>(null);
  /**
   * localStorageはサーバーには存在しないため、初期状態(サーバー/クライアント初回描画)は
   * 必ずnullにし、マウント後のeffectで読み込む。ここをuseState(() => loadProject())のような
   * 遅延初期化にすると、サーバーはnull・クライアントは実データで初回描画が食い違い、
   * Reactのハイドレーションエラー(ツリー全体の再描画)を引き起こす。
   */
  const [project, setProject] = useState<VideoProject | null>(null);
  const [hasCheckedProject, setHasCheckedProject] = useState(false);

  const [form, setForm] = useState<FormState>({ segments: [] });
  /**
   * 構造的な操作(追加・削除・複製・並べ替え)のUndo/Redo履歴。
   * ドラッグ中のトリムや文字入力のたびに積むと肥大化するため、対象は構造変更のみ。
   */
  const [history, setHistory] = useState<SegmentFormState[][]>([]);
  const [future, setFuture] = useState<SegmentFormState[][]>([]);
  /**
   * selectedSegmentKeyは「主選択(アンカー)」で、プレビューのシーク先・
   * Shiftクリック範囲選択の起点として使う。selectedKeysは一括削除の対象となる複数選択。
   * 通常のクリックでは両者は常に同期する(selectedKeys = {selectedSegmentKey})。
   */
  const [selectedSegmentKey, setSelectedSegmentKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  /** タイムラインでSE/BGMブロックが選択されている場合の選択状態(クリップ選択とは排他)。 */
  const [audioSelection, setAudioSelection] = useState<AudioSelection>(null);
  const [primaryColor, setPrimaryColor] = useState(project?.primaryColor ?? "#FF3366");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(project?.captionStyle ?? "pill");
  const [fontFamily, setFontFamily] = useState<CaptionFontFamily>(project?.fontFamily ?? "Noto Sans JP");
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(project?.captionPosition ?? "bottom");
  const [fontSize, setFontSize] = useState<CaptionFontSize>(project?.fontSize ?? "medium");
  const [fadeInOut, setFadeInOut] = useState(project?.fadeInOut ?? false);
  const [sfxClips, setSfxClips] = useState<ProjectSfxClip[]>(project?.sfx ?? []);
  const [bgm, setBgm] = useState<ProjectBgm | null>(project?.bgm ?? null);
  const [sfxUploading, setSfxUploading] = useState(false);
  const [bgmUploading, setBgmUploading] = useState(false);
  const [narrationVoice, setNarrationVoice] = useState(DEFAULT_VOICE_NAME);
  /** AIナレーション一括生成の進捗(nullなら未実行)。単発生成もtotal=1として同じ状態を使う。 */
  const [narrationGenerating, setNarrationGenerating] = useState<{ current: number; total: number } | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done">("idle");
  /**
   * 「動画カット/字幕/SE/AI音声/BGM/スタイル」のタブ切り替え。
   * プレビュー・書き出しは常時表示。タイムラインは残すが、タブごとに
   * 今やりたいことに関係あるトラックだけを表示する(TimelineRootのtracks props)。
   */
  const [activeTab, setActiveTab] = useState<"cut" | "caption" | "se" | "narration" | "bgm" | "style">("cut");
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditText, setBulkEditText] = useState("");

  const videoDurationInSeconds = project?.videoDurationInSeconds ?? 0;

  // マウント後にlocalStorageから前回の編集内容を読み込む(SSR/クライアント初回描画を
  // 一致させるため、useStateの遅延初期化ではなくここで行う)。localStorageは
  // Reactの外側にある一度きりのハイドレーション元であり、以降はローカルstateが
  // 正としてautosaveで書き戻す側になるため、react-hooks/set-state-in-effectが
  // 想定する「外部storeとの継続的な同期」には当たらない。
  useEffect(() => {
    const loaded = loadProject();
    if (loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorageからの一度きりの初期ハイドレーション
      setProject(loaded);
      setForm({ segments: loaded.segments });
      setPrimaryColor(loaded.primaryColor);
      setCaptionStyle(loaded.captionStyle);
      setFontFamily(loaded.fontFamily);
      setCaptionPosition(loaded.captionPosition);
      setFontSize(loaded.fontSize);
      setFadeInOut(loaded.fadeInOut);
      setSfxClips(loaded.sfx);
      setBgm(loaded.bgm);
    }
    setHasCheckedProject(true);
  }, []);

  // 編集内容(クリップ構成・スタイル・SE・BGM)を自動保存する(操作のたびに書き込まないよう
  // 少し待ってからまとめて保存する)。リロード/再訪問時にこの画面からそのまま再開できる。
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      saveProject({
        ...project,
        primaryColor,
        captionStyle,
        fontFamily,
        captionPosition,
        fontSize,
        fadeInOut,
        segments: form.segments,
        sfx: sfxClips,
        bgm,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    project,
    primaryColor,
    captionStyle,
    fontFamily,
    captionPosition,
    fontSize,
    fadeInOut,
    form.segments,
    sfxClips,
    bgm,
  ]);

  useEffect(() => {
    // テロップ更新などでプレビューのプレイヤーが再描画されると、内部の<video>要素が
    // 再生中に中断され AbortError("The operation was aborted.") が未処理の
    // Promise rejectionとして発生することがある。動画再生では無害な競合だが、
    // 開発モードのエラーオーバーレイが誤って壊れたように表示してしまうため抑制する。
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      const name =
        reason instanceof DOMException
          ? reason.name
          : typeof reason === "object" && reason !== null && "name" in reason
            ? (reason as { name?: unknown }).name
            : undefined;
      if (name === "AbortError") {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  const props = useMemo(
    () =>
      buildStandardVideoProps({
        videoPath: project?.videoPath ?? "",
        segments: form.segments,
        primaryColor,
        captionStyle,
        fontFamily,
        captionPosition,
        fontSize,
        fadeInOut,
        sfxClips,
        bgm,
      }),
    [form.segments, project?.videoPath, primaryColor, captionStyle, fontFamily, captionPosition, fontSize, fadeInOut, sfxClips, bgm]
  );
  const durationInFrames = useMemo(() => getStandardVideoDurationInFrames(props), [props]);

  /** 選択中クリップの、書き出し後の動画(=プレビュー)上での開始フレーム。 */
  const selectedClipStartFrame = useMemo(() => {
    if (!selectedSegmentKey) return null;
    const index = form.segments.findIndex((segment) => segment.key === selectedSegmentKey);
    if (index === -1) return null;
    return form.segments
      .slice(0, index)
      .reduce((sum, segment) => sum + Math.round(segment.durationInSeconds * VIDEO_FPS), 0);
  }, [selectedSegmentKey, form.segments]);
  const selectedClipStartFrameRef = useRef(selectedClipStartFrame);
  useEffect(() => {
    selectedClipStartFrameRef.current = selectedClipStartFrame;
  });

  // クリップの選択が切り替わった時だけプレビューをその位置までシークする
  // (トリム値の入力中などに毎回シークし直して邪魔にならないよう、選択切り替え時のみ発火させる)。
  useEffect(() => {
    if (selectedClipStartFrameRef.current === null) return;
    playerRef.current?.seekTo(selectedClipStartFrameRef.current);
  }, [selectedSegmentKey]);

  /**
   * プログラムモニター(Player)の現在フレーム。再生中はクリップ一覧のハイライトを
   * これに追従させる。
   * Playerはクリップが1件も無い間は描画されない(playerRef.currentがnull)ため、
   * クリップの有無が切り替わるタイミングで購読し直す。
   */
  const [previewFrame, setPreviewFrame] = useState(0);
  const hasClips = form.segments.length > 0;
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

  /** 今プレビューが再生しているクリップ(再生順)と、そのクリップ内での経過秒数。 */
  const segmentFrameRanges = useMemo(
    () =>
      form.segments.reduce<{ key: string; startFrame: number; endFrame: number }[]>((acc, segment) => {
        const startFrame = acc.length > 0 ? acc[acc.length - 1].endFrame : 0;
        const endFrame = startFrame + Math.round(segment.durationInSeconds * VIDEO_FPS);
        return [...acc, { key: segment.key, startFrame, endFrame }];
      }, []),
    [form.segments]
  );
  const activeProgramSegment = useMemo(() => {
    const current =
      segmentFrameRanges.find((range) => previewFrame < range.endFrame) ??
      segmentFrameRanges[segmentFrameRanges.length - 1];
    if (!current) return null;
    return { key: current.key, offsetSeconds: (previewFrame - current.startFrame) / VIDEO_FPS };
  }, [segmentFrameRanges, previewFrame]);

  const activeSegmentKey = activeProgramSegment?.key ?? null;

  const largestGap = useMemo(
    () => findLargestGap(form.segments, videoDurationInSeconds),
    [form.segments, videoDurationInSeconds]
  );

  const canAddSegment = form.segments.length < MAX_CLIPS && largestGap !== null;
  const canRemoveSegment = form.segments.length > 0;

  // 発話が無い区間はテロップが空文字列のまま正しい(無音区間として字幕なしで表示する)ため、
  // 全セグメントにテロップが入っていることは書き出しの条件にしない。
  const canRender = form.segments.length >= MIN_CLIPS && form.segments.length <= MAX_CLIPS;

  /** ヘッダーに出す簡易統計(総尺・クリップ数・文字数)。 */
  const stats = useMemo(
    () => ({
      totalSeconds: durationInFrames / VIDEO_FPS,
      clipCount: form.segments.length,
      charCount: form.segments.reduce((sum, segment) => sum + segment.caption.length, 0),
    }),
    [durationInFrames, form.segments]
  );

  // sfxClips配列にはSEとAIナレーションが同じ形で混在している(appendNarrationClip参照)。
  // データモデルは変えず、ラベルの絵文字プレフィックスで表示上だけ区別する
  // (「SE」「AI音声」タブそれぞれに、関係あるクリップだけを見せるため)。
  const isNarrationClip = (clip: ProjectSfxClip) => clip.label.startsWith("🎙");
  const sfxOnlyClips = useMemo(() => sfxClips.filter((c) => !isNarrationClip(c)), [sfxClips]);
  const narrationOnlyClips = useMemo(() => sfxClips.filter(isNarrationClip), [sfxClips]);

  const updateSegment = (
    key: string,
    patch: Partial<
      Pick<SegmentFormState, "caption" | "startFromSeconds" | "durationInSeconds" | "captionAnimation" | "volume">
    >
  ) => {
    setForm((prev) => ({
      ...prev,
      segments: applySegmentPatch(prev.segments, videoDurationInSeconds, key, patch),
    }));
  };

  /** 構造的な操作の直前に呼び、その時点の並びを履歴に積む(Redo履歴は破棄)。 */
  const pushHistory = () => {
    setHistory((prev) => [...prev, form.segments].slice(-50));
    setFuture([]);
  };

  /** 主選択(アンカー)と一括選択を同じキー1件だけに揃える。単純クリック時の共通処理。 */
  const selectOnly = (key: string | null) => {
    setSelectedSegmentKey(key);
    setSelectedKeys(key ? new Set([key]) : new Set());
    setAudioSelection(null);
  };

  /** タイムライン上でSEブロックを選択する(クリップ選択とは排他)。 */
  const selectSfx = (key: string) => {
    setSelectedSegmentKey(null);
    setSelectedKeys(new Set());
    setAudioSelection({ kind: "sfx", key });
  };

  /** タイムライン上でBGMブロックを選択する(クリップ選択とは排他)。 */
  const selectBgm = () => {
    setSelectedSegmentKey(null);
    setSelectedKeys(new Set());
    setAudioSelection({ kind: "bgm" });
  };

  const undo = () => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setFuture((f) => [form.segments, ...f]);
      setForm({ segments: last });
      selectOnly(null);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setHistory((h) => [...h, form.segments]);
      setForm({ segments: next });
      selectOnly(null);
      return prev.slice(1);
    });
  };

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  const handleStartOver = () => {
    if (!window.confirm("現在の編集内容を破棄して、新しい動画のアップロードからやり直しますか?")) {
      return;
    }
    clearProject();
    router.push("/create");
  };

  /**
   * 書き出しは別画面(/edit/export)に遷移して行う。自動保存は500ms遅延させているため、
   * 遷移直前の編集内容を確実に引き継げるよう、ここで同期的にlocalStorageへ書き戻してから
   * 遷移する。
   */
  const handleGoToExport = () => {
    if (!project || !canRender) return;
    saveProject({
      ...project,
      primaryColor,
      captionStyle,
      fontFamily,
      captionPosition,
      fontSize,
      fadeInOut,
      segments: form.segments,
      sfx: sfxClips,
      bgm,
    });
    router.push("/edit/export");
  };

  const addSegment = () => {
    if (!canAddSegment || !largestGap) return;
    const durationInSeconds = Math.min(
      Math.max(Math.min(DEFAULT_CLIP_DURATION_IN_SECONDS, largestGap.size), MIN_SEGMENT_DURATION_IN_SECONDS),
      largestGap.size
    );
    const newSegment: SegmentFormState = {
      key: crypto.randomUUID(),
      caption: "",
      startFromSeconds: largestGap.start,
      durationInSeconds,
      captionAnimation: DEFAULT_CAPTION_ANIMATION,
      volume: DEFAULT_CLIP_VOLUME,
    };
    pushHistory();
    // 新規クリップは常に再生順の末尾に追加する(元動画上のどこから切り出すかとは無関係)。
    setForm((prev) => ({
      ...prev,
      segments: [...prev.segments, newSegment],
    }));
    selectOnly(newSegment.key);
  };

  /** 指定した(複数の)クリップをまとめて削除する。単発削除・一括削除の両方から使う。 */
  const removeSegments = (keys: Set<string>) => {
    if (keys.size === 0 || !canRemoveSegment) return;
    pushHistory();
    setForm((prev) => ({
      ...prev,
      segments: prev.segments.filter((segment) => !keys.has(segment.key)),
    }));
    selectOnly(null);
  };

  /** クリップを複製し、複製元の直後(再生順)に挿入する。 */
  const duplicateSegment = (key: string) => {
    if (form.segments.length >= MAX_CLIPS) return;
    pushHistory();
    setForm((prev) => {
      const index = prev.segments.findIndex((segment) => segment.key === key);
      if (index === -1) return prev;
      const copy: SegmentFormState = { ...prev.segments[index], key: crypto.randomUUID() };
      const segments = [...prev.segments];
      segments.splice(index + 1, 0, copy);
      return { ...prev, segments };
    });
  };

  /** タイムライン上でのドラッグ操作で、draggedKeyのクリップをtargetKeyの位置(再生順)へ移動する。 */
  const reorderSegment = (draggedKey: string, targetKey: string) => {
    if (draggedKey === targetKey) return;
    if (!form.segments.some((s) => s.key === draggedKey) || !form.segments.some((s) => s.key === targetKey)) {
      return;
    }
    pushHistory();
    setForm((prev) => {
      const segments = [...prev.segments];
      const fromIndex = segments.findIndex((segment) => segment.key === draggedKey);
      const toIndex = segments.findIndex((segment) => segment.key === targetKey);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const [moved] = segments.splice(fromIndex, 1);
      segments.splice(toIndex, 0, moved);
      return { ...prev, segments };
    });
  };

  /** 選択中クリップの演出を全クリップへ一括適用する。 */
  const applyAnimationToAll = (animation: CaptionAnimation) => {
    pushHistory();
    setForm((prev) => ({
      ...prev,
      segments: prev.segments.map((segment) => ({ ...segment, captionAnimation: animation })),
    }));
  };

  /** 指定クリップを再生順で次のクリップと結合する(splitSegmentの逆操作)。 */
  const mergeSegmentWithNext = (key: string) => {
    setForm((prev) => {
      const index = prev.segments.findIndex((segment) => segment.key === key);
      if (index === -1 || !canMergeWithNext(prev.segments, index)) return prev;
      pushHistory();
      return { ...prev, segments: mergeWithNext(prev.segments, index) };
    });
  };

  /** 今プレビューが再生しているクリップを、再生ヘッドの位置で前後2クリップに分割できるか。 */
  const canSplitAtPlayhead = useMemo(() => {
    if (!activeProgramSegment || form.segments.length >= MAX_CLIPS) return false;
    const segment = form.segments.find((s) => s.key === activeProgramSegment.key);
    if (!segment) return false;
    return canSplitSegment(segment, activeProgramSegment.offsetSeconds);
  }, [activeProgramSegment, form.segments]);

  /** 今プレビューが再生しているクリップを、再生ヘッドの位置で分割する(mergeSegmentWithNextの逆操作)。 */
  const splitAtPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    setForm((prev) => {
      const index = prev.segments.findIndex((segment) => segment.key === key);
      if (index === -1 || prev.segments.length >= MAX_CLIPS) return prev;
      const segment = prev.segments[index];
      if (!canSplitSegment(segment, offsetSeconds)) return prev;
      pushHistory();
      const newKey = crypto.randomUUID();
      return { ...prev, segments: splitSegment(prev.segments, index, offsetSeconds, newKey) };
    });
  };

  /** 今プレビューが再生しているクリップの開始点(イン点)を、再生ヘッドの位置に打ち直す。 */
  const trimStartToPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    const segment = form.segments.find((s) => s.key === key);
    if (!segment) return;
    updateSegment(key, { startFromSeconds: segment.startFromSeconds + offsetSeconds });
  };

  /** 今プレビューが再生しているクリップの終了点(アウト点)を、再生ヘッドの位置に打ち直す。 */
  const trimEndToPlayhead = () => {
    if (!activeProgramSegment) return;
    const { key, offsetSeconds } = activeProgramSegment;
    updateSegment(key, { durationInSeconds: offsetSeconds });
  };

  /** スタイルプリセットを一括適用する。applyAnimation が true なら全クリップの演出も揃える。 */
  const applyStylePreset = (preset: StylePreset, applyAnimation: boolean) => {
    setPrimaryColor(preset.primaryColor);
    setCaptionStyle(preset.captionStyle);
    setFontFamily(preset.fontFamily);
    setCaptionPosition(preset.captionPosition);
    setFontSize(preset.fontSize);
    setFadeInOut(preset.fadeInOut);
    if (applyAnimation) {
      applyAnimationToAll(preset.captionAnimation);
    }
  };

  const openBulkEdit = () => {
    setBulkEditText(form.segments.map((segment) => segment.caption).join("\n"));
    setBulkEditOpen(true);
  };

  const bulkEditLines = bulkEditText.split("\n");
  const canApplyBulkEdit = bulkEditLines.length === form.segments.length;

  const applyBulkEdit = () => {
    if (!canApplyBulkEdit) return;
    pushHistory();
    setForm((prev) => ({
      ...prev,
      segments: prev.segments.map((segment, index) => ({ ...segment, caption: bulkEditLines[index] })),
    }));
    setBulkEditOpen(false);
  };

  /**
   * タイムライン上のクリップクリック。素クリックは単一選択、Ctrl/Cmd+クリックは個別トグル、
   * Shift+クリックは主選択(アンカー)から現在行までを範囲選択する(一般的なファイラー等と同じ挙動)。
   * Pointer Eventsベースのドラッグ処理(pointerDrag.ts)ではReact.MouseEventを扱いにくいため、
   * 必要な修飾キーだけを受け取る形にしている。
   */
  const selectSegment = (
    key: string,
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ) => {
    if (modifiers.shiftKey && selectedSegmentKey) {
      const anchorIndex = form.segments.findIndex((segment) => segment.key === selectedSegmentKey);
      if (anchorIndex !== -1) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        setSelectedKeys(new Set(form.segments.slice(from, to + 1).map((segment) => segment.key)));
        setAudioSelection(null);
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
      setAudioSelection(null);
      return;
    }
    selectOnly(key);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;
      // ボタン/セレクトにフォーカスがある時はSpace/矢印キーのネイティブな挙動
      // (ボタン押下・選択肢の移動)を優先し、プレイヤー操作に奪わないようにする。
      const isFocusedControl =
        target instanceof HTMLButtonElement || target instanceof HTMLSelectElement;
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
        const delta = e.key === "ArrowLeft" ? -1 : 1;
        player.seekTo(Math.max(0, player.getCurrentFrame() + delta));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const handleAddSfx = async (file: File | null) => {
    if (!file || sfxClips.length >= MAX_SFX_CLIPS) return;
    setSfxUploading(true);
    try {
      const { path, fileName } = await uploadAudioFile(file);
      // 現在の再生位置(プレビュー上の秒数)に追加する。総尺を超えないようクランプする。
      const currentSeconds = Math.min(
        stats.totalSeconds,
        Math.max(0, (playerRef.current?.getCurrentFrame() ?? 0) / VIDEO_FPS)
      );
      setSfxClips((prev) => [
        ...prev,
        {
          key: crypto.randomUUID(),
          src: path,
          label: fileName,
          startFromSeconds: currentSeconds,
          volume: DEFAULT_CLIP_VOLUME,
        },
      ]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "効果音のアップロードに失敗しました");
    } finally {
      setSfxUploading(false);
    }
  };

  /** アップロードなしで、同梱プリセット(著作権フリー)の効果音を現在の再生位置に追加する。 */
  const handleAddSfxPreset = (preset: AudioPreset) => {
    if (sfxClips.length >= MAX_SFX_CLIPS) return;
    const currentSeconds = Math.min(
      stats.totalSeconds,
      Math.max(0, (playerRef.current?.getCurrentFrame() ?? 0) / VIDEO_FPS)
    );
    setSfxClips((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        src: preset.src,
        label: preset.label,
        startFromSeconds: currentSeconds,
        volume: DEFAULT_CLIP_VOLUME,
      },
    ]);
  };

  const updateSfxClip = (key: string, patch: Partial<Pick<ProjectSfxClip, "startFromSeconds" | "volume">>) => {
    setSfxClips((prev) => prev.map((clip) => (clip.key === key ? { ...clip, ...patch } : clip)));
  };

  const removeSfxClip = (key: string) => {
    setSfxClips((prev) => prev.filter((clip) => clip.key !== key));
  };

  /** 指定クリップの、書き出し後の動画(=再生順)上での開始秒。ナレーション音声の配置に使う。 */
  const segmentStartSeconds = (index: number): number =>
    form.segments.slice(0, index).reduce((sum, segment) => sum + segment.durationInSeconds, 0);

  const appendNarrationClip = (startFromSeconds: number, caption: string, path: string) => {
    setSfxClips((prev) => {
      if (prev.length >= MAX_SFX_CLIPS) return prev;
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          src: path,
          label: `🎙 ${caption.slice(0, 12)}`,
          startFromSeconds,
          volume: DEFAULT_CLIP_VOLUME,
        },
      ];
    });
  };

  /** 選択中クリップのテロップをAIナレーション(読み上げ音声)に変換し、SEと同じ扱いでタイムラインに追加する。 */
  const handleGenerateNarrationForSegment = async (key: string) => {
    const index = form.segments.findIndex((segment) => segment.key === key);
    if (index === -1) return;
    const caption = form.segments[index].caption.trim();
    if (!caption) return;
    if (sfxClips.length >= MAX_SFX_CLIPS) {
      alert(`効果音/ナレーションの上限(${MAX_SFX_CLIPS}件)に達しているため追加できません`);
      return;
    }
    setNarrationGenerating({ current: 0, total: 1 });
    try {
      const { path } = await requestVoiceover(caption, narrationVoice);
      appendNarrationClip(segmentStartSeconds(index), caption, path);
    } catch (error) {
      alert(error instanceof Error ? error.message : "ナレーション生成に失敗しました");
    } finally {
      setNarrationGenerating(null);
    }
  };

  /** テロップが入っている全クリップ分、順番にAIナレーションを生成してタイムラインに追加する。 */
  const handleGenerateNarrationForAll = async () => {
    const targets = form.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.caption.trim().length > 0);
    if (targets.length === 0) return;

    let sfxCount = sfxClips.length;
    setNarrationGenerating({ current: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (sfxCount >= MAX_SFX_CLIPS) {
        alert(`効果音/ナレーションの上限(${MAX_SFX_CLIPS}件)に達したため、途中で停止しました`);
        break;
      }
      const { segment, index } = targets[i];
      const caption = segment.caption.trim();
      try {
        // Gemini APIはアプリ全体で直列実行が前提(rateLimiter.ts)のため、あえて逐次待つ
        const { path } = await requestVoiceover(caption, narrationVoice);
        appendNarrationClip(segmentStartSeconds(index), caption, path);
        sfxCount += 1;
      } catch (error) {
        alert(
          `「${caption.slice(0, 10)}」のナレーション生成に失敗しました: ${error instanceof Error ? error.message : ""}`
        );
        break;
      }
      setNarrationGenerating({ current: i + 1, total: targets.length });
    }
    setNarrationGenerating(null);
  };

  const handleSetBgm = async (file: File | null) => {
    if (!file) return;
    setBgmUploading(true);
    try {
      const { path, fileName } = await uploadAudioFile(file);
      setBgm({ src: path, label: fileName, volume: 0.4, fadeInSeconds: 0, fadeOutSeconds: 0 });
    } catch (error) {
      alert(error instanceof Error ? error.message : "BGMのアップロードに失敗しました");
    } finally {
      setBgmUploading(false);
    }
  };

  /** アップロードなしで、同梱プリセット(著作権フリー)のBGMに差し替える。 */
  const handleSetBgmPreset = (preset: AudioPreset) => {
    setBgm({ src: preset.src, label: preset.label, volume: 0.4, fadeInSeconds: 0, fadeOutSeconds: 0 });
  };

  const handleCopyCaptions = async () => {
    const text = form.segments
      .map((segment) => segment.caption)
      .filter((caption) => caption.trim().length > 0)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("done");
      setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      alert("クリップボードへのコピーに失敗しました");
    }
  };

  const handleExportProject = () => {
    if (!project) return;
    const exported: VideoProject = {
      ...project,
      primaryColor,
      captionStyle,
      fontFamily,
      captionPosition,
      fontSize,
      fadeInOut,
      segments: form.segments,
      sfx: sfxClips,
      bgm,
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.videoFileName ?? "project"}.editor-project.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportProjectFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    const imported = parseProjectJson(text);
    if (!imported) {
      alert("有効なプロジェクトファイルではありません");
      return;
    }
    if (!window.confirm("現在の編集内容を上書きしてインポートしますか?")) return;
    setProject(imported);
    setForm({ segments: imported.segments });
    setPrimaryColor(imported.primaryColor);
    setCaptionStyle(imported.captionStyle);
    setFontFamily(imported.fontFamily);
    setCaptionPosition(imported.captionPosition);
    setFontSize(imported.fontSize);
    setFadeInOut(imported.fadeInOut);
    setSfxClips(imported.sfx);
    setBgm(imported.bgm);
    setHistory([]);
    setFuture([]);
    selectOnly(null);
    saveProject(imported);
  };

  if (!hasCheckedProject) {
    return null;
  }

  if (!project) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={handleStartOver} className="btn-ghost text-xs">
          ← 別の動画からやり直す
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={handleExportProject} className="btn-ghost text-xs">
            ⬇ プロジェクトを書き出す
          </button>
          <label className="btn-ghost cursor-pointer text-xs">
            ⬆ プロジェクトを読み込む
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                void handleImportProjectFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {/* プログラムモニター(再生しながら編集できる中心のプレビュー)+ 選択中クリップのインスペクター */}
      <div className="editor-top-row">
        <div className="editor-preview-col">
          {form.segments.length > 0 ? (
            <div
              style={{
                height: "min(58vh, 620px)",
                aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}`,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--border-strong)",
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
          ) : (
            <div
              style={{
                height: "min(58vh, 620px)",
                aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}`,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 24,
                color: "var(--muted-2)",
                fontSize: 13,
                border: "1px dashed var(--border-strong)",
                background: "var(--background-elevated-2)",
              }}
            >
              クリップを追加するとここで再生確認できます
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs" style={{ color: "var(--muted-2)" }}>
            <span>総尺 {stats.totalSeconds.toFixed(1)}秒</span>
            <span>クリップ {stats.clipCount}個</span>
            <span>文字数 {stats.charCount}字</span>
            <button type="button" onClick={handleCopyCaptions} className="btn-ghost px-2 py-1 text-xs">
              {copyStatus === "done" ? "✓ コピーしました" : "字幕をコピー"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--muted-2)" }}>
            Space=再生/一時停止・←→=1フレーム送り・S=分割・I/O=再生位置をイン/アウト点に
          </p>
        </div>

        {activeTab === "cut" ? (
          <ClipInspectorPanel
            segments={form.segments}
            selectedSegmentKey={selectedSegmentKey}
            selectedCount={selectedKeys.size}
            onUpdateSegment={updateSegment}
            onMergeWithNext={mergeSegmentWithNext}
            onDuplicate={duplicateSegment}
            onRemove={(key) => removeSegments(new Set([key]))}
            onDeleteSelected={() => removeSegments(selectedKeys)}
          />
        ) : activeTab === "caption" ? (
          <CaptionInspectorPanel
            segments={form.segments}
            selectedSegmentKey={selectedSegmentKey}
            selectedCount={selectedKeys.size}
            sfxCount={sfxClips.length}
            maxSfxClips={MAX_SFX_CLIPS}
            onUpdateSegment={updateSegment}
            onApplyAnimationToAll={applyAnimationToAll}
            narrationGenerating={narrationGenerating}
            onGenerateNarrationForSegment={(key) => void handleGenerateNarrationForSegment(key)}
            onOpenBulkEdit={openBulkEdit}
            canOpenBulkEdit={form.segments.length > 0}
          />
        ) : activeTab === "se" ? (
          <SfxInspectorPanel
            audioSelection={audioSelection}
            sfxClips={sfxOnlyClips}
            totalSfxCount={sfxClips.length}
            sfxUploading={sfxUploading}
            maxSfxClips={MAX_SFX_CLIPS}
            sfxPresets={SFX_PRESETS}
            onUpdateSfx={updateSfxClip}
            onRemoveSfx={removeSfxClip}
            onAddSfxFile={(file) => void handleAddSfx(file)}
            onAddSfxPreset={handleAddSfxPreset}
          />
        ) : activeTab === "narration" ? (
          <NarrationInspectorPanel
            segments={form.segments}
            audioSelection={audioSelection}
            narrationClips={narrationOnlyClips}
            totalSfxCount={sfxClips.length}
            maxSfxClips={MAX_SFX_CLIPS}
            onUpdateSfx={updateSfxClip}
            onRemoveSfx={removeSfxClip}
            voiceOptions={VOICE_OPTIONS}
            narrationVoice={narrationVoice}
            onChangeNarrationVoice={setNarrationVoice}
            narrationGenerating={narrationGenerating}
            onGenerateNarrationForAll={() => void handleGenerateNarrationForAll()}
          />
        ) : activeTab === "bgm" ? (
          <BgmInspectorPanel
            audioSelection={audioSelection}
            bgm={bgm}
            bgmUploading={bgmUploading}
            bgmPresets={BGM_PRESETS}
            onSetBgmField={(patch) => setBgm((prev) => (prev ? { ...prev, ...patch } : prev))}
            onRemoveBgm={() => setBgm(null)}
            onSetBgmFile={(file) => void handleSetBgm(file)}
            onSetBgmPreset={handleSetBgmPreset}
          />
        ) : null}
      </div>

      {/* タブ切り替え(動画カット/字幕/SE/AI音声/BGM/スタイル)。プレビュー・タイムライン・書き出しは常時表示。 */}
      <div className="tab-bar">
        <button
          type="button"
          onClick={() => setActiveTab("cut")}
          className={`tab-button${activeTab === "cut" ? " active" : ""}`}
        >
          動画カット
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("caption")}
          className={`tab-button${activeTab === "caption" ? " active" : ""}`}
        >
          字幕
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("se")}
          className={`tab-button${activeTab === "se" ? " active" : ""}`}
        >
          SE
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("narration")}
          className={`tab-button${activeTab === "narration" ? " active" : ""}`}
        >
          AI音声
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("bgm")}
          className={`tab-button${activeTab === "bgm" ? " active" : ""}`}
        >
          BGM
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("style")}
          className={`tab-button${activeTab === "style" ? " active" : ""}`}
        >
          スタイル
        </button>
      </div>

      {activeTab === "style" ? (
        <div className="panel flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">スタイルプリセット</h2>
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              配色・フォント・位置・見た目・演出をまとめて1クリックで適用します
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyStylePreset(preset, true)}
                  className="preset-card flex flex-col gap-1 p-3"
                  title={preset.description}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 shrink-0 rounded-full"
                      style={{ background: preset.primaryColor, border: "1px solid var(--border-strong)" }}
                    />
                    <span className="text-xs font-semibold">{preset.label}</span>
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--muted-2)" }}>
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-4 border-t pt-4"
            style={{ borderColor: "var(--border)" }}
          >
            <label className="flex items-center gap-2">
              <span className="field-label">配色</span>
              <input
                type="color"
                className="h-8 w-14"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="field-label">見た目</span>
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
                className="field-input w-fit py-1 text-sm"
              >
                {CAPTION_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="field-label">フォント</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as CaptionFontFamily)}
                className="field-input w-fit py-1 text-sm"
              >
                {CAPTION_FONT_FAMILY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="field-label">位置</span>
              <select
                value={captionPosition}
                onChange={(e) => setCaptionPosition(e.target.value as CaptionPosition)}
                className="field-input w-fit py-1 text-sm"
              >
                {CAPTION_POSITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="field-label">文字サイズ</span>
              <select
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value as CaptionFontSize)}
                className="field-input w-fit py-1 text-sm"
              >
                {CAPTION_FONT_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fadeInOut} onChange={(e) => setFadeInOut(e.target.checked)} />
              <span className="field-label">全体フェードイン/アウト</span>
            </label>
          </div>
        </div>
      ) : null}

      {activeTab !== "style" ? (
        <TimelineRoot
          segments={form.segments}
          sfxClips={activeTab === "se" ? sfxOnlyClips : activeTab === "narration" ? narrationOnlyClips : sfxClips}
          bgm={bgm}
          videoPath={project.videoPath}
          totalDurationSeconds={stats.totalSeconds}
          currentSeconds={previewFrame / VIDEO_FPS}
          selectedKeys={selectedKeys}
          activeSegmentKey={activeSegmentKey}
          audioSelection={audioSelection}
          onSelectSegment={selectSegment}
          onTrimStart={(key, value) => updateSegment(key, { startFromSeconds: value })}
          onTrimEnd={(key, value) => updateSegment(key, { durationInSeconds: value })}
          onReorder={reorderSegment}
          onSelectSfx={selectSfx}
          onMoveSfx={(key, value) => updateSfxClip(key, { startFromSeconds: value })}
          onSelectBgm={selectBgm}
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
          showCutTools={activeTab === "cut"}
          tracks={{
            video: true,
            sfx: activeTab === "se" || activeTab === "narration",
            bgm: activeTab === "bgm",
          }}
        />
      ) : null}

      <button
        type="button"
        onClick={handleGoToExport}
        disabled={!canRender}
        className="btn-primary flex h-14 items-center justify-center px-6 text-base"
      >
        動画を書き出す →
      </button>

      {bulkEditOpen ? (
        <div className="modal-backdrop" onClick={() => setBulkEditOpen(false)}>
          <div
            className="modal-panel flex flex-col gap-3 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold">字幕を一括編集</h2>
            <p className="text-xs" style={{ color: "var(--muted-2)" }}>
              1行=1クリップです。行を増減すると適用できません(現在{bulkEditLines.length}行 / クリップ
              {form.segments.length}個)。
            </p>
            <textarea
              value={bulkEditText}
              onChange={(e) => setBulkEditText(e.target.value)}
              className="field-input flex-1"
              style={{ minHeight: 280, resize: "vertical", fontFamily: "inherit" }}
            />
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setBulkEditOpen(false)} className="btn-ghost text-xs">
                キャンセル
              </button>
              <button
                type="button"
                onClick={applyBulkEdit}
                disabled={!canApplyBulkEdit}
                className="btn-primary px-4 py-1.5 text-sm"
              >
                適用
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
