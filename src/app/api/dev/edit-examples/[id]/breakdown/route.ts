import { NextResponse, after } from "next/server";
import { listEditExamples } from "@/lib/gemini/editExamplesStore";
import { breakdownEditExample } from "@/lib/gemini/editExampleBreakdown";

export const runtime = "nodejs";

/**
 * 学習データ1件の正解動画の書き起こしを作り直す(editExampleBreakdown.ts)。数分かかるため、
 * 同期で待たせるとブラウザ側の接続が切れてしまう。裏で作り、画面は一覧を読み直して完了を待つ。
 * 作った書き起こしはexamples.jsonに入るので、本番で作った場合は他の登録内容と同じくgitコミットする。
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const example = (await listEditExamples()).find((item) => item.id === id);
  if (!example) {
    return NextResponse.json({ error: "対象の編集例が見つかりません" }, { status: 404 });
  }
  if (!example.rawMediaFilename) {
    return NextResponse.json({ error: "学習動画(編集前)が無い編集例は書き起こせません" }, { status: 400 });
  }
  after(async () => {
    await breakdownEditExample(example).catch((error) => {
      console.error(`[edit-examples] 「${example.label}」の書き起こしに失敗しました`, error);
    });
  });
  return NextResponse.json({ ok: true });
}
