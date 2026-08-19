import { randomUUID } from "node:crypto";

export type RenderJob =
  | { status: "rendering"; progress: number }
  | { status: "done"; progress: 1; url: string }
  | { status: "error"; progress: number; message: string };

/**
 * 単一Node.jsプロセスの前提でのインメモリなジョブ管理。
 * サーバレス/複数インスタンス構成では成立しない(この用途はNode常駐サーバ運用を前提としている)。
 */
const jobs = new Map<string, RenderJob>();

const JOB_TTL_MS = 10 * 60 * 1000;

export const createRenderJob = (): string => {
  const id = randomUUID();
  jobs.set(id, { status: "rendering", progress: 0 });
  return id;
};

export const updateRenderJob = (id: string, job: RenderJob) => {
  jobs.set(id, job);
  if (job.status !== "rendering") {
    setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref();
  }
};

export const getRenderJob = (id: string): RenderJob | undefined => jobs.get(id);
