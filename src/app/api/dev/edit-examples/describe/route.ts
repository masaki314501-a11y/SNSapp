import { NextResponse } from "next/server";
import { listEditExamples } from "@/lib/gemini/editExamplesStore";
import { describeMissingEditExamples } from "@/lib/gemini/editExampleSelection";

export const runtime = "nodejs";

/**
 * 「どんな動画か」の説明がまだ無い手本の説明をまとめて作る(近い手本を選ぶ仕組みを入れる前に
 * 登録した手本や、登録時の説明作成に失敗した手本のため)。作った説明はexamples.jsonに入るので、
 * 本番で作った場合は他の登録内容と同じくダウンロードしてgitコミットする。
 */
export async function POST() {
  const result = await describeMissingEditExamples();
  const examples = await listEditExamples();
  return NextResponse.json({ ...result, examples });
}
