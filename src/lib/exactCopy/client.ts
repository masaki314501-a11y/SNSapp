/**
 * 完全模倣(EC)を、画面(ブラウザ)から動かすための処理。今までの作り方(src/lib/editSteps/client.ts)の写しから始め、
 * 送り先を完全模倣のAPI(/api/exact-copy)にし、チェック項目(工程14)と、それによるやり直しは行わない。
 */
import type { VideoProject } from "@/lib/videoProject";
import type { CheckItem } from "@/lib/editSteps/checklist";
import type { EditStepsRecord, StepState } from "@/lib/editSteps/logic";
import { EDIT_STEPS } from "@/lib/editSteps/steps";
import { EMPTY_STATE, keepRangesOf, withState } from "@/lib/editSteps/client";

/** 完全模倣で流す最後の段(編集マニュアルの手順の最後。チェック項目の工程14は行わない)。 */
export const EXACT_LAST_STEP = 13;

type StepResponse = { state: StepState; note: string; details?: string[]; checks?: CheckItem[] };

/** 完全模倣の1段(編集マニュアルの工程の順)を実行し、済ませたプロジェクトを返す。 */
const runExactStep = async (project: VideoProject, step: number, signal?: AbortSignal): Promise<VideoProject> => {
  const record: EditStepsRecord = project.editSteps ?? { results: {}, snapshots: {} };
  const base = step === 1 ? EMPTY_STATE : record.snapshots[step - 1];
  if (!base) throw new Error(`工程${step - 1}がまだ終わっていません`);
  const keepRanges = keepRangesOf(project);
  const response = await fetch("/api/exact-copy", {
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

export type ExactProgress = { step: number; title: string };

/** 完全模倣を初めから最後まで流す。1段終わるごとに onStep で途中のプロジェクトを渡す。 */
export const runExactCopy = async (
  project: VideoProject,
  options: { onProgress?: (progress: ExactProgress) => void; onStep?: (project: VideoProject) => void; signal?: AbortSignal } = {}
): Promise<VideoProject> => {
  let current: VideoProject = { ...project, editSteps: { results: {}, snapshots: {}, reviewed: {} } };
  for (let step = 1; step <= EXACT_LAST_STEP; step++) {
    options.onProgress?.({ step, title: EDIT_STEPS[step - 1].title });
    current = await runExactStep(current, step, options.signal);
    options.onStep?.(current);
  }
  return current;
};
