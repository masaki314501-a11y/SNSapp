import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "aac"]);
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * 効果音(SE)・BGM用の音声アップロードAPI。src/app/api/upload/route.ts(動画用)と同じ設計だが、
 * 保存先(public/audio/)と許可する拡張子が異なる。
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `対応していない拡張子です: .${ext || "unknown"}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "ファイルサイズが大きすぎます(上限20MB)" },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const dir = path.join(process.cwd(), "public", "audio");
  await mkdir(dir, { recursive: true });

  const filename = `${id}.${ext}`;
  const outputPath = path.join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(outputPath, buffer);

  return NextResponse.json({ path: `audio/${filename}`, fileName: file.name });
}
