import { NextResponse } from "next/server";
import { cancelAutoEditJob, getAutoEditJob } from "@/lib/gemini/autoEditJobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getAutoEditJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "ジョブが見つかりません" }, { status: 404 });
  }

  return NextResponse.json(job);
}

/** 処理中の自動編集を止める(画面の「キャンセル」)。もう終わっていれば何もしない。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  return NextResponse.json({ cancelled: cancelAutoEditJob(jobId) });
}
