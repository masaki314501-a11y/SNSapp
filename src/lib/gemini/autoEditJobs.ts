import { randomUUID } from "node:crypto";
import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import type { AutoEditPlan } from "./autoEditPlan";
import type { RawAutoEditPlan } from "./autoEditTypes";
import type { AutoEditProgress } from "@/lib/autoEditProgress";

/** 画面に見せる編集案の概要(クリップ自体はsegmentsとして組み立て済みで返す)。 */
export type AutoEditPlanSummary = Pick<AutoEditPlan, "summary" | "referenceNotes" | "theme" | "hook" | "hookCandidates" | "cta" | "globalOverlays" | "globalImages" | "globalShapes" | "framing" | "generatedImageCount" | "imageSources">;

export type AutoEditJob =
  | ({ status: "processing" } & Partial<AutoEditProgress>)
  | {
      status: "done";
      plan: AutoEditPlanSummary;
      segments: ProjectSegment[];
      generatedClips: ProjectSfxClip[];
      /** Geminiの生の答え。手直しのときに画面から送り返してもらう。 */
      rawPlan: RawAutoEditPlan;
      /** 元の動画で話している区間(元の動画の秒数)。音を調べられなかった時はnull。 */
      speechSpans: [number, number][] | null;
    }
  | { status: "error"; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理(extractStyleJobs.ts等と同じ方針)。
 */
const jobs = new Map<string, AutoEditJob>();

/**
 * 終わったジョブを残しておく時間。スマホで待っている間に別のアプリへ切り替えたり画面を閉じたりしても、
 * 戻ってきた時に結果を受け取れるよう、長めに残す(画面はジョブの番号を覚えていて、開き直すと続きから見る)。
 */
const JOB_TTL_MS = 60 * 60 * 1000;

export const createAutoEditJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "processing" });
  return id;
};

/** 止めたジョブ。動いている処理は次の段階に進む所で止まる(isAutoEditJobCancelled で確かめる)。 */
const cancelled = new Set<string>();

export const updateAutoEditJob = (id: string, job: AutoEditJob) => {
  // 止めた後に処理の結果が届いても書き込まない
  if (cancelled.has(id)) return;
  jobs.set(id, job);
  if (job.status === "done" || job.status === "error") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

/** 処理中のジョブの段階を進める(終わったジョブは書き換えない)。 */
export const updateAutoEditProgress = (id: string, progress: AutoEditProgress) => {
  if (jobs.get(id)?.status === "processing") jobs.set(id, { status: "processing", ...progress });
};

export const getAutoEditJob = (id: string): AutoEditJob | undefined => jobs.get(id);

/** ジョブを止める。処理中でなければ(もう終わっていれば)何もせずfalse。 */
export const cancelAutoEditJob = (id: string): boolean => {
  if (jobs.get(id)?.status !== "processing") return false;
  cancelled.add(id);
  jobs.delete(id);
  setTimeout(() => cancelled.delete(id), JOB_TTL_MS).unref();
  return true;
};

export const isAutoEditJobCancelled = (id: string): boolean => cancelled.has(id);
