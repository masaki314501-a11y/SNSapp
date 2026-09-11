import { NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";

/**
 * アップロード動画・音声・レンダー結果はサーバー起動後に public/ 配下へ書き込まれる。
 * Next.jsのpublicフォルダ配信はビルド時点のスナップショットしか返さず、
 * 起動後に増えたファイルは本番ビルドで404になる(next dev では気づけない)ため、
 * これらのディレクトリだけはリクエスト都度ファイルシステムを見て直接配信する。
 */
const ALLOWED_DIRS = new Set(["videos", "audio", "renders"]);
const SAFE_SEGMENT = /^[0-9a-zA-Z_.-]+$/;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  aac: "audio/aac",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const [dir, ...rest] = segments ?? [];
  if (
    !dir ||
    !ALLOWED_DIRS.has(dir) ||
    rest.length === 0 ||
    rest.length > 2 ||
    rest.some((segment) => !SAFE_SEGMENT.test(segment))
  ) {
    return NextResponse.json({ error: "不正なパスです" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", dir, ...rest);

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  const ext = (rest[rest.length - 1].split(".").pop() ?? "").toLowerCase();
  const contentType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
