import { NextResponse } from "next/server";
import { getReviseEditJob } from "@/lib/gemini/reviseEditJobs";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getReviseEditJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "ジョブが見つかりません(サーバーが再起動した可能性があります)" }, { status: 404 });
  }
  return NextResponse.json(job);
}
