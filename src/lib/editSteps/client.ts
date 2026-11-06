/**
 * 工程ごとの編集を、画面(ブラウザ)から動かすための処理。
 * 「工程ごとに編集」画面(1工程ずつ)と、「AIで自動編集する」(工程1〜14をまとめて自動で流す)の両方で使う。
 */
import type { VideoProject } from "@/lib/videoProject";
import type { CheckItem } from "./checklist";
import type { EditStepsRecord, StepState } from "./logic";
import { EDIT_STEPS } from "./steps";

/** チェック項目を確かめる工程。 */
export const CHECK_STEP = 14;

export const EMPTY_STATE: StepState = { segments: [], framing: null, captionYPercent: null, globalShapes: [], globalOverlays: [] };

/** 工程の状態をプロジェクトに書き込む(プレビュー・この後の画面で使う)。 */
export const withState = (project: VideoProject, state: StepState): VideoProject => ({
  ...project,
  segments: state.segments,
  framing: state.framing ?? undefined,
  captionYPercent: state.captionYPercent ?? undefined,
  videoAdjust: state.videoAdjust ?? undefined,
  // 基本テロップの見た目は工程10で決める(それより前は、プロジェクトの設定のまま)
  ...(state.captionLook
    ? { fontFamily: state.captionLook.fontFamily, captionStyle: state.captionLook.captionStyle, primaryColor: state.captionLook.primaryColor }
    : {}),
  // BGMは工程13で入れる(それより前の工程では、前から入っていた物をそのままにする)
  bgm: state.bgm === undefined ? project.bgm : state.bgm,
  globalShapes: state.globalShapes,
  globalOverlays: state.globalOverlays,
  // 工程ごとの編集では、冒頭の見出し・締めの一言・画像は付けない。効果音は強調テロップの物だけ(クリップに付いている)
  hook: null,
  cta: null,
  globalImages: [],
  sfx: [],
});

/** カット画面で残した範囲(工程1はいつもここから並べ直す)。 */
export const keepRangesOf = (project: VideoProject) =>
  (project.cutKeepRanges ?? project.segments).map((segment) => ({
    startFromSeconds: segment.startFromSeconds,
    durationInSeconds: segment.durationInSeconds,
  }));

type StepResponse = { state: StepState; note: string; details?: string[]; checks?: CheckItem[] };

/** 工程を1つ実行し、その工程を済ませたプロジェクトを返す(この工程より後ろの結果は消す)。 */
export const runEditStep = async (project: VideoProject, step: number, signal?: AbortSignal): Promise<VideoProject> => {
  const record: EditStepsRecord = project.editSteps ?? { results: {}, snapshots: {} };
  const base = step === 1 ? EMPTY_STATE : record.snapshots[step - 1];
  if (!base) throw new Error(`工程${step - 1}がまだ終わっていません`);
  const keepRanges = keepRangesOf(project);
  const response = await fetch("/api/edit-step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      step,
      videoPath: project.videoPath,
      videoDurationInSeconds: project.videoDurationInSeconds,
      keepRanges,
      state: base,
      // 長さの上限は、短くしたい時だけ(指定が無ければ、動画の長さのまま)
      targetSeconds: project.targetDurationSeconds ?? undefined,
      bgm: project.stepBgmChoice ?? null,
      zone: project.publishZone ?? "tiktok",
      title: project.autoEditTitle?.trim() || undefined,
      globalImages: project.globalImages ?? [],
      styleReferences: (project.styleReferences ?? []).map((reference) => reference.path),
      look: {
        captionStyle: project.captionStyle,
        fontSize: project.fontSize,
        primaryColor: project.primaryColor,
        fontFamily: project.fontFamily,
        captionTextStyleId: project.captionTextStyleId,
        hasBgm: Boolean(project.bgm),
      },
    }),
  });
  const json = (await response.json().catch(() => null)) as (StepResponse & { error?: string }) | null;
  if (!response.ok || !json?.state) throw new Error(json?.error ?? `工程${step}を実行できませんでした`);
  const results = Object.fromEntries(Object.entries(record.results).filter(([key]) => Number(key) < step));
  const snapshots = Object.fromEntries(Object.entries(record.snapshots).filter(([key]) => Number(key) < step));
  return {
    ...withState(project, json.state),
    // 工程1を始めた時点で、カット画面で残した範囲を覚えておく(工程1はいつもここから並べ直す)
    cutKeepRanges: keepRanges,
    editSteps: {
      results: { ...results, [step]: { note: json.note, details: json.details, checks: json.checks, at: new Date().toISOString() } },
      snapshots: { ...snapshots, [step]: json.state },
      // 中身が変わったので、目で確かめたチェックは付け直してもらう
      reviewed: {},
    },
  };
};

/**
 * チェック項目が「要修正」の時に、やり直すと直る見込みがある工程(AIの答えのぶれで起きる物だけ)。
 * 決まった計算で決まる項目(冒頭5秒のカット数など)は、やり直しても同じなので入れない。
 */
export const RETRY_STEP_BY_CHECK: Record<string, number> = {
  sync: 9,
  "caption-time": 9,
  typo: 9,
  colors: 8,
  fonts: 8,
  "safe-zone": 8,
  sfx: 10,
  length: 12,
};

/** 自動で流した時に、チェック項目を満たすまでやり直す回数の上限。 */
export const MAX_AUTO_RETRIES = 2;

/** 工程14の結果から、やり直す工程(一番前の物)を選ぶ。やり直しても直らない項目しか無ければ null。 */
export const stepToRetry = (checks: CheckItem[]): number | null => {
  const steps = checks.filter((item) => item.status === "ng").map((item) => RETRY_STEP_BY_CHECK[item.id]).filter((step) => step !== undefined);
  return steps.length > 0 ? Math.min(...steps) : null;
};

export type AutoRunProgress = { step: number; title: string; attempt: number };

/**
 * 工程1〜14を自動で順に流す(「AIで自動編集する」)。工程ごとの編集と同じ工程・同じチェック項目を使う。
 * 工程14のチェックで「要修正」が出て、やり直すと直る見込みがある時は、その工程から流し直す(MAX_AUTO_RETRIES回まで)。
 * 1工程終わるごとに onStep で途中のプロジェクトを渡す(保存して、画面を閉じても途中から見られるように)。
 */
export const runAllSteps = async (
  project: VideoProject,
  options: { onProgress?: (progress: AutoRunProgress) => void; onStep?: (project: VideoProject) => void; signal?: AbortSignal } = {}
): Promise<{ project: VideoProject; retries: number }> => {
  let current = { ...project, editSteps: { results: {}, snapshots: {}, reviewed: {} } } as VideoProject;
  let from = 1;
  let retries = 0;
  for (;;) {
    for (let step = from; step <= CHECK_STEP; step++) {
      options.onProgress?.({ step, title: EDIT_STEPS[step - 1].title, attempt: retries });
      current = await runEditStep(current, step, options.signal);
      options.onStep?.(current);
    }
    const retry = stepToRetry(current.editSteps?.results[CHECK_STEP]?.checks ?? []);
    if (retry === null || retries >= MAX_AUTO_RETRIES) return { project: current, retries };
    retries += 1;
    from = retry;
  }
};
