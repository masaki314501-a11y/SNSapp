import { randomUUID } from "node:crypto";
import type { ProjectSegment, ProjectSfxClip } from "@/lib/videoProject";
import type { AutoEditPlan } from "./autoEditPlan";

/** 画面に見せる編集案の概要(クリップ自体はsegmentsとして組み立て済みで返す)。 */
export type AutoEditPlanSummary = Pick<AutoEditPlan, "summary" | "referenceNotes" | "theme" | "hook" | "cta" | "globalOverlays">;

export type AutoEditJob =
  | { status: "processing" }
  | { status: "done"; plan: AutoEditPlanSummary; segments: ProjectSegment[]; generatedClips: ProjectSfxClip[] }
  | { status: "error"; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理(extractStyleJobs.ts等と同じ方針)。
 */
const jobs = new Map<string, AutoEditJob>();

const JOB_TTL_MS = 10 * 60 * 1000;

export const createAutoEditJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "processing" });
  return id;
};

export const updateAutoEditJob = (id: string, job: AutoEditJob) => {
  jobs.set(id, job);
  if (job.status === "done" || job.status === "error") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

export const getAutoEditJob = (id: string): AutoEditJob | undefined => jobs.get(id);
