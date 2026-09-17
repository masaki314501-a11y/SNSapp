import { NextResponse } from "next/server";
import { z } from "zod";
import { extractedStyleSchema, type ExtractedStyle } from "@/lib/gemini/extractStyle";
import {
  addStyleExample,
  isSupportedStyleExampleMimeType,
  listStyleExamples,
  styleExampleKindForMimeType,
} from "@/lib/gemini/styleExamplesStore";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

/**
 * スタイル抽出のfew-shot例(正解データ)を管理する開発者向けAPI。UIから直接は導線を
 * 張らず、開発者が `/dev/style-examples` を直接開いて使う想定(README「開発者用」欄参照)。
 * 手元に多数の動画がある場合はこのAPIより /api/dev/style-examples/import
 * (data/style-examples/inbox/ からの一括取り込み)の方が早い。
 */
export async function GET() {
  const examples = await listStyleExamples();
  return NextResponse.json({ examples });
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "画像または動画ファイルが必要です" }, { status: 400 });
  }
  if (!isSupportedStyleExampleMimeType(file.type)) {
    return NextResponse.json(
      { error: "対応していない形式です(画像: PNG/JPEG/WebP、動画: MP4/MOV/WebM/M4V)" },
      { status: 400 }
    );
  }
  const kind = styleExampleKindForMimeType(file.type);
  const extension = EXTENSION_BY_MIME_TYPE[file.type];
  if (!kind || !extension) {
    return NextResponse.json({ error: "対応していない形式です" }, { status: 400 });
  }
  const maxSize = kind === "video" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `ファイルサイズが大きすぎます(上限${Math.floor(maxSize / (1024 * 1024))}MB)` },
      { status: 400 }
    );
  }

  const correctStyleRaw = formData.get("correctStyle");
  if (typeof correctStyleRaw !== "string") {
    return NextResponse.json({ error: "correctStyle が必要です" }, { status: 400 });
  }
  const correctStyleParsed = extractedStyleSchema.safeParse(JSON.parse(correctStyleRaw));
  if (!correctStyleParsed.success) {
    return NextResponse.json(
      { error: "正解データの内容が不正です", issues: correctStyleParsed.error.issues },
      { status: 400 }
    );
  }

  const labelRaw = formData.get("label");
  const label = z.string().trim().max(200).optional().parse(
    typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : undefined
  );

  const mediaBuffer = Buffer.from(await file.arrayBuffer());

  const example = await addStyleExample({
    kind,
    mediaBuffer,
    extension,
    mimeType: file.type,
    correctStyle: correctStyleParsed.data as ExtractedStyle,
    label,
  });

  return NextResponse.json({ example });
}
