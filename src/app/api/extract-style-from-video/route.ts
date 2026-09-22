import { NextResponse, after } from "next/server";
import { z } from "zod";
import { readGeminiApiKeyOverride } from "@/lib/gemini/apiKeyHeader";
import { extractStyle } from "@/lib/gemini/extractStyle";
import { createExtractStyleJob, updateExtractStyleJob } from "@/lib/gemini/extractStyleJobs";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";

export const runtime = "nodejs";

const requestSchema = z.object({
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
});

/**
 * 参考動画(競合の投稿など、/api/uploadで既にアップロード済みのもの)からテロップスタイル
 * (配色・フォント・配置・背景の付き方・出現演出)を抽出するAPI。画像版(/api/extract-style)と
 * 同じジョブストア(extractStyleJobs.ts)・同じポーリングエンドポイント(/api/extract-style/[jobId])
 * を共有する。
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "リクエスト内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const resolved = await resolveUploadedVideo(parsed.data.videoPath);
  if (!resolved) {
    return NextResponse.json({ error: "参考動画が見つかりません" }, { status: 400 });
  }

  const apiKeyOverride = readGeminiApiKeyOverride(request);
  const jobId = createExtractStyleJob();

  after(async () => {
    try {
      const style = await extractStyle({
        kind: "video",
        absoluteVideoPath: resolved.absolutePath,
        mimeType: resolved.mimeType,
        apiKeyOverride,
      });
      updateExtractStyleJob(jobId, { status: "done", ...style });
    } catch (error) {
      console.error("[extract-style-from-video] スタイル抽出に失敗しました", error);
      updateExtractStyleJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "スタイル抽出に失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
