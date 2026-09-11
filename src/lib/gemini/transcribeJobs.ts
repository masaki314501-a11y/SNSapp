import { randomUUID } from "node:crypto";
import type { TranscribedSegment } from "./transcribeCaptions";

export type TranscribeJobPhase = "uploading" | "processing" | "generating";

export type TranscribeJob =
  | { status: TranscribeJobPhase }
  | { status: "done"; segments: TranscribedSegment[] }
  | { status: "error"; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理(renderJobs.tsと同じ方針)。
 */
const jobs = new Map<string, TranscribeJob>();

const JOB_TTL_MS = 10 * 60 * 1000;

export const createTranscribeJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "uploading" });
  return id;
};

export const updateTranscribeJob = (id: string, job: TranscribeJob) => {
  jobs.set(id, job);
  if (job.status === "done" || job.status === "error") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

export const getTranscribeJob = (id: string): TranscribeJob | undefined => jobs.get(id);
