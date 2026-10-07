import { readFile } from "node:fs/promises";
import { NextResponse, after } from "next/server";
import { extractStyle } from "@/lib/gemini/extractStyle";
import { createExtractStyleJob, updateExtractStyleJob } from "@/lib/gemini/extractStyleJobs";
import { REFERENCE_IMAGE_PATH_PATTERN, resolveStyleReference, saveReferenceImage } from "@/lib/styleReference";
import { MAX_STYLE_REFERENCES } from "@/lib/styleReferenceLimits";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  // 参考スクショは複数枚渡せる。追加・削除のたびに全部の画像でまとめて抽出し直すため、
  // 新しく選んだ画像(image)と、前に保存済みの画像のパス(referencePath)の両方を受け取る
  // (保存済みの画像を毎回送り直して同じファイルを何度も保存しないように)。
  const files = formData.getAll("image");
  const savedPaths = formData.getAll("referencePath");
  if (files.length + savedPaths.length === 0) {
    return NextResponse.json({ error: "画像ファイルが必要です" }, { status: 400 });
  }
  if (files.length + savedPaths.length > MAX_STYLE_REFERENCES) {
    return NextResponse.json(
      { error: `参考画像は${MAX_STYLE_REFERENCES}枚までです` },
      { status: 400 }
    );
  }

  const images: { base64: string; mimeType: string }[] = [];
  const referencePaths: string[] = [];
  for (const savedPath of savedPaths) {
    if (typeof savedPath !== "string" || !REFERENCE_IMAGE_PATH_PATTERN.test(savedPath)) {
      return NextResponse.json({ error: "参考画像の指定が不正です" }, { status: 400 });
    }
    const saved = await resolveStyleReference(savedPath);
    // サーバー再起動等で消えていた画像は飛ばす(残りの画像だけで抽出する)。
    if (!saved) continue;
    images.push({ base64: (await readFile(saved.absolutePath)).toString("base64"), mimeType: saved.mimeType });
    referencePaths.push(savedPath);
  }
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "画像ファイルが必要です" }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "画像はPNG/JPEG/WebP形式のみ対応しています" },
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "画像サイズが大きすぎます(1枚あたり上限10MB)" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    images.push({ base64: buffer.toString("base64"), mimeType: file.type });
    // 自動編集が同じスクショを最優先の手本として見られるよう、抽出とは別に保存しておく。
    referencePaths.push(await saveReferenceImage(buffer, file.type));
  }
  if (images.length === 0) {
    return NextResponse.json(
      { error: "参考画像がサーバー上に見つかりませんでした。もう一度選び直してください" },
      { status: 400 }
    );
  }

  const jobId = createExtractStyleJob();

  // Gemini呼び出しはサーバープロセス全体で直列化されており(rateLimiter.ts)、他の
  // 文字起こしジョブ等が詰まっていたり無料枠の混雑でリトライが重なると数十秒〜1分以上
  // かかることがある。同期レスポンスで待たせるとブラウザ側のfetchがタイムアウト/切断され
  // "Load failed" 等のネットワークエラーになってしまうため、レンダーAPI等と同様に
  // ジョブ化してポーリングで結果を取得する方式にする。
  after(async () => {
    try {
      const style = await extractStyle({ kind: "image", images });
      updateExtractStyleJob(jobId, { status: "done", ...style });
    } catch (error) {
      console.error("[extract-style] スタイル抽出に失敗しました", error);
      updateExtractStyleJob(jobId, {
        status: "error",
        message: toFriendlyErrorMessage(error, "スタイル抽出に失敗しました"),
      });
    }
  });

  return NextResponse.json({ jobId, referencePaths });
}
