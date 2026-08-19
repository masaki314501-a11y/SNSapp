import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getServeUrl } from "@/lib/remotion/bundle";
import { shortVideoSchema } from "@video/compositions/ShortVideo/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = shortVideoSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力内容が不正です", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const inputProps = parsed.data;

  try {
    const serveUrl = await getServeUrl();

    const composition = await selectComposition({
      serveUrl,
      id: "ShortVideo",
      inputProps,
    });

    const id = randomUUID();
    const outDir = path.join(process.cwd(), "public", "renders");
    await mkdir(outDir, { recursive: true });
    const outputLocation = path.join(outDir, `${id}.mp4`);

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
    });

    return NextResponse.json({ url: `/renders/${id}.mp4` });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "レンダーに失敗しました",
      },
      { status: 500 }
    );
  }
}
