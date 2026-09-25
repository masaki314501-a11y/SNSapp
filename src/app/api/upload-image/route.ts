import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 動画に差し込む画像(ロゴ・商品写真・図など)のアップロードAPI。upload-audio/route.tsと同じ設計で、
 * 保存先(public/images/)と許可する拡張子だけが異なる。配信は/api/media経由(起動後に増えた
 * ファイルは通常のpublic配信では返らないため)。
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
      { error: `対応していない画像形式です: .${ext || "unknown"}(PNG/JPEG/WebP/GIFに対応)` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "画像が大きすぎます(上限10MB)" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "public", "images");
  await mkdir(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ path: `images/${filename}`, fileName: file.name });
}
