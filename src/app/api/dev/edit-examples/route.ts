import { NextResponse, after } from "next/server";
import { z } from "zod";
import { listEditExamples, regenerateEditExampleDigest, registerEditExample } from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

/**
 * 自動編集機能のfew-shot例(学習動画・正解動画)を管理する開発者向けAPI。UIから直接は
 * 導線を張らず、開発者が `/dev/edit-examples` を直接開いて使う想定(/dev/style-examples
 * と同じ運用)。
 * 動画本体は先に /api/dev/edit-examples/upload でストリーム保存済み。ここではその
 * ファイル名とメタデータ(ラベル・メモ)だけをJSONで受け取って登録する
 * (formData()でファイルごと受け取るとメモリ不足になるため。理由はeditExamplesStore.ts参照)。
 */
export async function GET() {
  const examples = await listEditExamples();
  return NextResponse.json({ examples });
}

const registerSchema = z.object({
  label: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional(),
  correctMediaFilename: z.string().min(1),
  correctMimeType: z.string().min(1),
  rawMediaFilename: z.string().min(1).optional(),
  rawMimeType: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
  }

  const example = await registerEditExample(parsed.data);

  // 動画そのものを毎回few-shotに使うと高コストなため、登録直後に1回だけ解析して
  // 軽量な要約(digest)を作り保存する。解析には時間がかかるため登録レスポンスは待たせず、
  // バックグラウンドで行う(失敗しても登録自体は成功しており、次回以降は動画で
  // フォールバックされる)。
  after(async () => {
    try {
      await regenerateEditExampleDigest(example.id);
    } catch (error) {
      console.error(`[edit-examples] 編集例(${example.id})の要約生成に失敗しました`, error);
    }
  });

  return NextResponse.json({ example });
}
