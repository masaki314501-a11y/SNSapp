import { NextResponse } from "next/server";
import { listEditExamples } from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

/**
 * data/edit-examples/examples.json と同じ形式でメタデータをそのまま返す。
 * Render等のデプロイ環境で登録した内容はディスクが永続化されないため消えてしまう
 * (editExamplesStore.ts参照)。本番で登録した後にこれをダウンロードし、動画本体
 * (GET /[id]/media)と合わせてローカルの data/edit-examples/ に配置してgitコミット
 * すれば、次のデプロイでも残る。
 */
export async function GET() {
  const examples = await listEditExamples();
  return new NextResponse(`${JSON.stringify(examples, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="examples.json"',
    },
  });
}
