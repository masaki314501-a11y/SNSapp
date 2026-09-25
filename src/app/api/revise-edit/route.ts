import { NextResponse, after } from "next/server";
import { z } from "zod";
import { editableStateSchema, reviseEdit } from "@/lib/gemini/reviseEdit";
import { createReviseEditJob, updateReviseEditJob } from "@/lib/gemini/reviseEditJobs";

export const runtime = "nodejs";

const requestSchema = z.object({
  instruction: z.string().trim().min(1).max(1000),
  selectedClipId: z.number().int().nullable(),
  videoDurationInSeconds: z.number().positive(),
  state: editableStateSchema,
});

/**
 * 編集画面の「AIに修正を頼む」。今の編集内容と修正依頼(文章)を受け取り、Geminiに依頼どおり
 * 直した編集内容を作らせる。反映するかは利用者が画面で決める。Geminiの応答待ちで
 * 数十秒かかりうるため、他のGemini系エンドポイントと同じくジョブ化してポーリングする。
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "リクエスト内容が不正です", issues: parsed.error.issues }, { status: 400 });
  }

  const jobId = createReviseEditJob();
  after(async () => {
    try {
      const result = await reviseEdit(parsed.data);
      updateReviseEditJob(jobId, { status: "done", ...result });
    } catch (error) {
      console.error("[revise-edit] AI修正に失敗しました", error);
      updateReviseEditJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "AI修正に失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
