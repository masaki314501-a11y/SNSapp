import { randomUUID } from "node:crypto";
import type { ReviseEditResult } from "./reviseEdit";

export type ReviseEditJob =
  | { status: "processing" }
  | ({ status: "done" } & ReviseEditResult)
  | { status: "error"; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理(autoEditJobs.ts等と同じ方針)。
 */
const jobs = new Map<string, ReviseEditJob>();

const JOB_TTL_MS = 10 * 60 * 1000;

export const createReviseEditJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "processing" });
  return id;
};

export const updateReviseEditJob = (id: string, job: ReviseEditJob) => {
  jobs.set(id, job);
  if (job.status === "done" || job.status === "error") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

export const getReviseEditJob = (id: string): ReviseEditJob | undefined => jobs.get(id);
