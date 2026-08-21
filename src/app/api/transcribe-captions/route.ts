import { stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { transcribeCaptions } from "@/lib/gemini/transcribeCaptions";
import { MIN_CLIPS, MAX_CLIPS } from "@video/templates/standard/schema";

export const runtime = "nodejs";

// アップロードAPI(src/app/api/upload/route.ts)が `videos/{uuid}.{ext}` の形式で
// 保存するため、それ以外のパスはパストラバーサル防止のため拒否する。
const VIDEO_PATH_PATTERN = /^videos\/[0-9a-f-]+\.(mp4|mov|webm|m4v)$/i;

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
};

const requestSchema = z.object({
  videoPath: z.string().regex(VIDEO_PATH_PATTERN),
  segments: z
    .array(
      z.object({
        startFromSeconds: z.number().min(0),
        durationInSeconds: z.number().positive(),
      })
    )
    .min(MIN_CLIPS)
    .max(MAX_CLIPS),
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

  const { videoPath, segments } = parsed.data;
  const absoluteVideoPath = path.join(process.cwd(), "public", videoPath);

  const fileStat = await stat(absoluteVideoPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    return NextResponse.json({ error: "動画が見つかりません" }, { status: 400 });
  }

  const ext = videoPath.split(".").pop()!.toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION[ext];

  try {
    const captions = await transcribeCaptions({ absoluteVideoPath, mimeType, segments });
    return NextResponse.json({ captions });
  } catch (error) {
    console.error("[transcribe-captions] 文字起こしに失敗しました", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "文字起こしに失敗しました",
      },
      { status: 500 }
    );
  }
}
