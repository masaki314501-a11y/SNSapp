import { NextResponse } from "next/server";
import { getExtractStyleJob } from "@/lib/gemini/extractStyleJobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getExtractStyleJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "ジョブが見つかりません" }, { status: 404 });
  }

  return NextResponse.json(job);
}
