import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlacesByText } from "@/lib/googleMaps/places";

export const runtime = "nodejs";

const requestSchema = z.object({ query: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "検索キーワードを入力してください" }, { status: 400 });
  }

  try {
    const results = await searchPlacesByText(parsed.data.query);
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[insights/search-place] 検索に失敗しました", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "検索に失敗しました" },
      { status: 500 }
    );
  }
}
