import { NextResponse } from "next/server";
import { readStyleExampleMedia } from "@/lib/gemini/styleExamplesStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const media = await readStyleExampleMedia(id);
  if (!media) {
    return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(media.buffer), {
    headers: {
      "Content-Type": media.mimeType,
      "Cache-Control": "no-store",
    },
  });
}
