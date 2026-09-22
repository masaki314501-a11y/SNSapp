import { NextResponse, after } from "next/server";
import { z } from "zod";
import { readGeminiApiKeyOverride } from "@/lib/gemini/apiKeyHeader";
import { transcribeCaptions } from "@/lib/gemini/transcribeCaptions";
import { createTranscribeJob, updateTranscribeJob } from "@/lib/gemini/transcribeJobs";
import { MIN_CLIPS, MAX_CLIPS } from "@video/templates/standard/schema";
import { VIDEO_PATH_PATTERN, resolveUploadedVideo } from "@/lib/uploadedVideo";

export const runtime = "nodejs";

const requestSchema = z.object({
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
  videoDurationInSeconds: z.number().positive(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "リクエスト内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { videoPath, videoDurationInSeconds } = parsed.data;
  const resolved = await resolveUploadedVideo(videoPath);
  if (!resolved) {
    return NextResponse.json({ error: "動画が見つかりません" }, { status: 400 });
  }
  const { absolutePath: absoluteVideoPath, mimeType } = resolved;

  const apiKeyOverride = readGeminiApiKeyOverride(request);
  const jobId = createTranscribeJob();

  // 動画アップロード・処理待ち・生成に数十秒かかるため、レンダーAPIと同様に
  // レスポンス返却後もバックグラウンドで進行させ、進捗はジョブストアをポーリングして取得する。
  after(async () => {
    try {
      const segments = await transcribeCaptions({
        absoluteVideoPath,
        mimeType,
        videoDurationInSeconds,
        minClips: MIN_CLIPS,
        maxClips: MAX_CLIPS,
        onProgress: (phase) => updateTranscribeJob(jobId, { status: phase }),
        apiKeyOverride,
      });
      updateTranscribeJob(jobId, { status: "done", segments });
    } catch (error) {
      console.error("[transcribe-captions] 文字起こしに失敗しました", error);
      updateTranscribeJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "文字起こしに失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
