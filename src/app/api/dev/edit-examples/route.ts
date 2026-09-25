import { NextResponse } from "next/server";
import { z } from "zod";
import { listEditExamples, registerEditExample } from "@/lib/gemini/editExamplesStore";
import { describeEditExample } from "@/lib/gemini/editExampleSelection";

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
  // 自動編集で「近い手本」を選ぶための説明文を、登録と同時に作っておく(editExampleSelection.ts)。
  // 失敗しても登録自体は成功扱いにし、あとで一覧の「説明を作る」から作り直せるようにする。
  const described = await describeEditExample(example).catch((error) => {
    console.warn("[edit-examples] 手本の説明の作成に失敗しました", error);
    return null;
  });
  return NextResponse.json({ example: described ?? example });
}
