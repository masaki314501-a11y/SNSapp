import { NextResponse } from "next/server";
import { getPlaceDetails } from "@/lib/googleMaps/places";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ placeId: string }> }
) {
  const { placeId } = await params;

  try {
    const details = await getPlaceDetails(placeId);
    return NextResponse.json(details);
  } catch (error) {
    console.error("[insights/place-details] 取得に失敗しました", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "店舗情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
