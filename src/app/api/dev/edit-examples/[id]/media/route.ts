import { NextResponse } from "next/server";
import { z } from "zod";
import { readEditExampleMedia } from "@/lib/gemini/editExamplesStore";

export const runtime = "nodejs";

const whichSchema = z.enum(["correct", "raw"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const whichParsed = whichSchema.safeParse(new URL(request.url).searchParams.get("which") ?? "correct");
  if (!whichParsed.success) {
    return NextResponse.json({ error: "whichはcorrectかrawを指定してください" }, { status: 400 });
  }

  const media = await readEditExampleMedia(id, whichParsed.data);
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
