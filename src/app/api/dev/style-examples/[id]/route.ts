import { NextResponse } from "next/server";
import { deleteStyleExample } from "@/lib/gemini/styleExamplesStore";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteStyleExample(id);
  if (!deleted) {
    return NextResponse.json({ error: "対象の正解データが見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
