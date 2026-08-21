import { NextResponse } from "next/server";
import { generateScript } from "@/lib/gemini/generateScript";
import { MIN_CLIPS, MAX_CLIPS } from "@video/templates/standard/schema";

export const runtime = "nodejs";

const MAX_SCREENSHOT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const title = formData.get("title");
  if (typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json(
      { error: "タイトル/キーワードを入力してください" },
      { status: 400 }
    );
  }

  const clipCountRaw = formData.get("clipCount");
  const clipCount = Number(clipCountRaw);
  if (!Number.isFinite(clipCount) || clipCount < MIN_CLIPS || clipCount > MAX_CLIPS) {
    return NextResponse.json(
      { error: `クリップ数は${MIN_CLIPS}〜${MAX_CLIPS}個で指定してください` },
      { status: 400 }
    );
  }

  const clipNotesRaw = formData.get("clipNotes");
  let clipNotes: (string | undefined)[] | undefined;
  if (typeof clipNotesRaw === "string" && clipNotesRaw.length > 0) {
    try {
      const parsed = JSON.parse(clipNotesRaw);
      if (Array.isArray(parsed)) {
        clipNotes = parsed.map((note) => (typeof note === "string" ? note : undefined));
      }
    } catch {
      // 不正なJSONは無視し、内容メモなしで生成を続行する。
    }
  }

  const screenshotFile = formData.get("screenshot");
  let screenshot: { base64: string; mimeType: string } | null = null;

  if (screenshotFile instanceof File && screenshotFile.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(screenshotFile.type)) {
      return NextResponse.json(
        { error: "スクリーンショットはPNG/JPEG/WebP形式のみ対応しています" },
        { status: 400 }
      );
    }
    if (screenshotFile.size > MAX_SCREENSHOT_SIZE_BYTES) {
      return NextResponse.json(
        { error: "スクリーンショットのサイズが大きすぎます(上限10MB)" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await screenshotFile.arrayBuffer());
    screenshot = { base64: buffer.toString("base64"), mimeType: screenshotFile.type };
  }

  const result = await generateScript({ title, clipCount, clipNotes, screenshot });

  return NextResponse.json(result);
}
