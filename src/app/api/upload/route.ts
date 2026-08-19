import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);
const MAX_SIZE_BYTES = 200 * 1024 * 1024;

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
      { error: "ファイルサイズが大きすぎます(上限200MB)" },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const filename = `${id}.${ext}`;
  const dir = path.join(process.cwd(), "public", "videos");
  await mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, filename), buffer);

  // ShortVideoProps.clips[].src にそのまま入れられる相対パス
  return NextResponse.json({ path: `videos/${filename}` });
}
