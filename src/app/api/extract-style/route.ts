import { NextResponse, after } from "next/server";
import { readGeminiApiKeyOverride } from "@/lib/gemini/apiKeyHeader";
import { extractStyle } from "@/lib/gemini/extractStyle";
import { createExtractStyleJob, updateExtractStyleJob } from "@/lib/gemini/extractStyleJobs";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "画像ファイルが必要です" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "画像はPNG/JPEG/WebP形式のみ対応しています" },
      { status: 400 }
    );
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "画像サイズが大きすぎます(上限10MB)" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const imageBase64 = buffer.toString("base64");
  const mimeType = file.type;
  const apiKeyOverride = readGeminiApiKeyOverride(request);

  const jobId = createExtractStyleJob();

  // Gemini呼び出しはサーバープロセス全体で直列化されており(rateLimiter.ts)、他の
  // 文字起こしジョブ等が詰まっていたり無料枠の混雑でリトライが重なると数十秒〜1分以上
  // かかることがある。同期レスポンスで待たせるとブラウザ側のfetchがタイムアウト/切断され
  // "Load failed" 等のネットワークエラーになってしまうため、レンダーAPI等と同様に
  // ジョブ化してポーリングで結果を取得する方式にする。
  after(async () => {
    try {
      const style = await extractStyle({ kind: "image", imageBase64, mimeType, apiKeyOverride });
      updateExtractStyleJob(jobId, { status: "done", ...style });
    } catch (error) {
      console.error("[extract-style] スタイル抽出に失敗しました", error);
      updateExtractStyleJob(jobId, {
        status: "error",
        message: error instanceof Error ? error.message : "スタイル抽出に失敗しました",
      });
    }
  });

  return NextResponse.json({ jobId });
}
