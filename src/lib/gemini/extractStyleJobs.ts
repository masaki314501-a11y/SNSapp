import { randomUUID } from "node:crypto";
import type { ExtractedStyle } from "./extractStyle";

export type ExtractStyleJob =
  | { status: "processing" }
  | ({ status: "done" } & ExtractedStyle)
  | { status: "error"; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理(renderJobs.ts/transcribeJobs.tsと同じ方針)。
 */
const jobs = new Map<string, ExtractStyleJob>();

const JOB_TTL_MS = 10 * 60 * 1000;

export const createExtractStyleJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "processing" });
  return id;
};

export const updateExtractStyleJob = (id: string, job: ExtractStyleJob) => {
  jobs.set(id, job);
  if (job.status === "done" || job.status === "error") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

export const getExtractStyleJob = (id: string): ExtractStyleJob | undefined => jobs.get(id);
