import { unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import {
  extensionForVideoMimeType,
  isSupportedEditExampleVideoMimeType,
  reserveEditExampleMediaPath,
} from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * 学習・正解動画1本分のバイト列をストリームのままディスクに書き込むAPI。
 * multipart/form-dataではなく生のバイト列を送ってもらう(理由はeditExamplesStore.ts参照)。
 * 登録処理本体(メタデータの追加)はこの後に呼ばれる /api/dev/edit-examples(JSON)が行う。
 */
export async function POST(request: Request) {
  const which = new URL(request.url).searchParams.get("which");
  if (which !== "correct" && which !== "raw") {
    return NextResponse.json({ error: "whichはcorrectかrawを指定してください" }, { status: 400 });
  }

  const mimeType = request.headers.get("x-mime-type") ?? "";
  if (!isSupportedEditExampleVideoMimeType(mimeType)) {
    return NextResponse.json({ error: "対応していない動画形式です(MP4/MOV/WebM/M4V)" }, { status: 400 });
  }
  const extension = extensionForVideoMimeType(mimeType);
  if (!extension) {
    return NextResponse.json({ error: "対応していない動画形式です" }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_VIDEO_SIZE_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが大きすぎます(上限200MB)" }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "ファイルが必要です" }, { status: 400 });
  }

  const labelHeader = request.headers.get("x-label");
  const label = labelHeader ? decodeURIComponent(labelHeader) : "example";

  const { filename, absolutePath } = await reserveEditExampleMediaPath(which, label, extension);

  let written = 0;
  const enforceLimit = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      written += chunk.length;
      if (written > MAX_VIDEO_SIZE_BYTES) {
        throw new Error("ファイルサイズが大きすぎます(上限200MB)");
      }
      yield chunk;
    }
  };

  try {
    await pipeline(
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>),
      enforceLimit,
      createWriteStream(absolutePath)
    );
  } catch (error) {
    await unlink(absolutePath).catch(() => {});
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "アップロードに失敗しました" },
      { status: 400 }
    );
  }

  return NextResponse.json({ filename, mimeType });
}
