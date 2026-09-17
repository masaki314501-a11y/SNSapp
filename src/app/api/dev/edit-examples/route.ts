import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addEditExample,
  extensionForVideoMimeType,
  isSupportedEditExampleVideoMimeType,
  listEditExamples,
} from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * 自動編集機能のfew-shot例(学習動画・正解動画)を管理する開発者向けAPI。UIから直接は
 * 導線を張らず、開発者が `/dev/edit-examples` を直接開いて使う想定(/dev/style-examples
 * と同じ運用)。
 */
export async function GET() {
  const examples = await listEditExamples();
  return NextResponse.json({ examples });
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const labelRaw = formData.get("label");
  const labelParsed = z.string().trim().min(1).max(200).safeParse(labelRaw);
  if (!labelParsed.success) {
    return NextResponse.json({ error: "ラベルが必要です" }, { status: 400 });
  }
  const label = labelParsed.data;

  const notesRaw = formData.get("notes");
  const notes = typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim().slice(0, 1000) : undefined;

  const correctFile = formData.get("correct");
  if (!(correctFile instanceof File) || correctFile.size === 0) {
    return NextResponse.json({ error: "正解動画(完成した参考動画)が必要です" }, { status: 400 });
  }
  if (!isSupportedEditExampleVideoMimeType(correctFile.type)) {
    return NextResponse.json({ error: "対応していない動画形式です(MP4/MOV/WebM/M4V)" }, { status: 400 });
  }
  if (correctFile.size > MAX_VIDEO_SIZE_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが大きすぎます(上限200MB)" }, { status: 400 });
  }
  const correctExtension = extensionForVideoMimeType(correctFile.type);
  if (!correctExtension) {
    return NextResponse.json({ error: "対応していない動画形式です" }, { status: 400 });
  }

  const rawFile = formData.get("raw");
  let rawInput:
    | { rawBuffer: Buffer; rawExtension: string; rawMimeType: string }
    | undefined;
  if (rawFile instanceof File && rawFile.size > 0) {
    if (!isSupportedEditExampleVideoMimeType(rawFile.type)) {
      return NextResponse.json({ error: "学習動画(元素材)の形式が対応していません(MP4/MOV/WebM/M4V)" }, { status: 400 });
    }
    if (rawFile.size > MAX_VIDEO_SIZE_BYTES) {
      return NextResponse.json({ error: "学習動画のファイルサイズが大きすぎます(上限200MB)" }, { status: 400 });
    }
    const rawExtension = extensionForVideoMimeType(rawFile.type);
    if (!rawExtension) {
      return NextResponse.json({ error: "学習動画の形式が対応していません" }, { status: 400 });
    }
    rawInput = {
      rawBuffer: Buffer.from(await rawFile.arrayBuffer()),
      rawExtension,
      rawMimeType: rawFile.type,
    };
  }

  const correctBuffer = Buffer.from(await correctFile.arrayBuffer());

  const example = await addEditExample({
    label,
    notes,
    correctBuffer,
    correctExtension,
    correctMimeType: correctFile.type,
    ...rawInput,
  });

  return NextResponse.json({ example });
}
