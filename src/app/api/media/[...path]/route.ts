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

/**
 * パスの1セグメントとして許容できるか判定する。SAFE_SEGMENT は "." "-" を許可するため、
 * セグメント単体では "." や ".." も文字種チェックだけは通ってしまう。path.join後に
 * 上位ディレクトリへ抜けられないよう、"." ".." は明示的に禁止する。
 */
export const isValidPathSegment = (segment: string): boolean =>
  segment !== "." && segment !== ".." && SAFE_SEGMENT.test(segment);

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
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  const [dir, ...rest] = segments ?? [];
  if (
    !dir ||
    !ALLOWED_DIRS.has(dir) ||
    rest.length === 0 ||
    rest.length > 2 ||
    rest.some((segment) => !isValidPathSegment(segment))
  ) {
    return NextResponse.json({ error: "不正なパスです" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", dir, ...rest);

  let size: number;
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
    }
    size = fileStat.size;
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }

  const ext = (rest[rest.length - 1].split(".").pop() ?? "").toLowerCase();
  const contentType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";

  // iOS/iPadOS の「ビデオを保存」やAirPlay、動画のシークバー操作はHTTP Range
  // リクエスト(部分取得)に依存しているため、対応しないと保存・再生に失敗する。
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const stream = Readable.toWeb(
      createReadStream(filePath, { start, end })
    ) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}
