import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v"]);
const MAX_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * クライアントからは multipart/form-data ではなく生のバイト列を送ってもらう(uploadVideoFile.ts参照)。
 * 以前は request.formData() でパースしていたが、Node(undici)のformData()実装はファイル全体を
 * 一度メモリ上のBlobに載せてから返すため、メモリの少ない本番環境(Render無料プラン=512MB)で
 * 大きい動画のアップロード時にメモリ不足でクラッシュ/タイムアウトすることがあった。
 * リクエストボディをストリームのまま書き込むことで、ファイル全体をメモリに保持しないようにする。
 */
export async function POST(request: Request) {
  const fileNameHeader = request.headers.get("x-file-name");
  const fileName = fileNameHeader ? decodeURIComponent(fileNameHeader) : "";
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `対応していない拡張子です: .${ext || "unknown"}` },
      { status: 400 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "ファイルサイズが大きすぎます(上限200MB)" },
      { status: 400 }
    );
  }

  if (!request.body) {
    return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  }

  const id = randomUUID();
  const dir = path.join(process.cwd(), "public", "videos");
  await mkdir(dir, { recursive: true });
  const filename = `${id}.${ext}`;
  const outputPath = path.join(dir, filename);

  let written = 0;
  const enforceLimit = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      written += chunk.length;
      if (written > MAX_SIZE_BYTES) {
        throw new Error("ファイルサイズが大きすぎます(上限200MB)");
      }
      yield chunk;
    }
  };

  try {
    await pipeline(
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>),
      enforceLimit,
      createWriteStream(outputPath)
    );
  } catch (error) {
    await unlink(outputPath).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "アップロードに失敗しました" },
      { status: 400 }
    );
  }

  // ShortVideoProps.clips[].src にそのまま入れられる相対パス
  return NextResponse.json({ path: `videos/${filename}` });
}
