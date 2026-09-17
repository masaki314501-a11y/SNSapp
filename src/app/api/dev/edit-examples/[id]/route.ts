import { NextResponse } from "next/server";
import { deleteEditExample } from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteEditExample(id);
  if (!deleted) {
    return NextResponse.json({ error: "対象の編集例が見つかりません" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
