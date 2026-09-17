import { NextResponse } from "next/server";
import {
  importStyleExamplesFromInbox,
  listInboxFiles,
  listStyleExamples,
} from "@/lib/gemini/styleExamplesStore";

export const runtime = "nodejs";

/** data/style-examples/inbox/ に取り込み待ちのファイルが何件あるかを返す。 */
export async function GET() {
  const files = await listInboxFiles();
  return NextResponse.json({ files });
}

/**
 * data/style-examples/inbox/ に置いた動画・画像ファイル + answers.json をまとめて
 * 正解データとして取り込む(README・data/style-examples/inbox/README.md参照)。
 */
export async function POST() {
  const result = await importStyleExamplesFromInbox();
  const examples = await listStyleExamples();
  return NextResponse.json({ ...result, examples });
}
