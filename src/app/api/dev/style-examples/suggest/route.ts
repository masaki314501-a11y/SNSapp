import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { extractStyle } from "@/lib/gemini/extractStyle";
import {
  isSupportedStyleExampleMimeType,
  styleExampleKindForMimeType,
} from "@/lib/gemini/styleExamplesStore";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * 正解データを登録する前に、「今のAIならこの参考動画/画像をどう読むか」を返す開発者向けAPI。
 * 登録画面はこれを下書きとしてフォームに流し込むため、人間は全項目を入力するのではなく
 * 間違っているところだけ直せばよくなる。同時に、既に登録済みのfew-shot例込みで推論するので、
 * 「この素材はもう正しく読めている(=登録しても増えるものが少ない)」かどうかも分かる。
 *
 * 動画はGemini File API経由で渡す都合上一度ディスクに置く必要があるため、一時ファイルに
 * 書き出してから渡し、終わったら消す(登録前なのでdata/配下には残さない)。
 */
export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");
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
  if (!kind) {
    return NextResponse.json({ error: "対応していない形式です" }, { status: 400 });
  }
  const maxSize = kind === "video" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: `ファイルサイズが大きすぎます(上限${Math.floor(maxSize / (1024 * 1024))}MB)` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let tempDir: string | null = null;
  try {
    if (kind === "image") {
      const style = await extractStyle({
        kind: "image",
        imageBase64: buffer.toString("base64"),
        mimeType: file.type,
      });
      return NextResponse.json({ style });
    }

    tempDir = await mkdtemp(path.join(tmpdir(), "style-suggest-"));
    const tempPath = path.join(tempDir, "source");
    await writeFile(tempPath, buffer);
    const style = await extractStyle({ kind: "video", absoluteVideoPath: tempPath, mimeType: file.type });
    return NextResponse.json({ style });
  } catch (error) {
    console.error("[dev/style-examples/suggest] スタイル抽出に失敗しました", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "スタイル抽出に失敗しました" },
      { status: 500 }
    );
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
