import { NextResponse } from "next/server";
import { getPlaceDetails } from "@/lib/googleMaps/places";
import { toFriendlyErrorMessage } from "@/lib/friendlyError";

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
      { error: toFriendlyErrorMessage(error, "店舗情報の取得に失敗しました") },
      { status: 500 }
    );
  }
}
