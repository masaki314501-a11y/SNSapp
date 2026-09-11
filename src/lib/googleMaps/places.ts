import { z } from "zod";

/**
 * Google Places API (New) の薄いラッパー。APIキーのみで使え(OAuth不要)、口コミ等の
 * 公開情報は自社・競合を問わず取得できる。ただしPlace Details 1回のレスポンスに含まれる
 * 口コミは仕様上最大5件までで、全件取得はできない
 * (全件は自社の場所に限りGoogle Business Profile API + OAuthが必要、対象外)。
 */

const PLACES_API_BASE = "https://places.googleapis.com/v1";

const getApiKey = (): string => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEYが未設定です");
  }
  return key;
};

const extractErrorMessage = async (res: Response): Promise<string> => {
  const body = await res.json().catch(() => null);
  const message = (body as { error?: { message?: string } } | null)?.error?.message;
  return message ?? `Google Places APIの呼び出しに失敗しました(HTTP ${res.status})`;
};

const displayNameSchema = z.object({ text: z.string() }).optional();

export type PlaceSearchResult = {
  id: string;
  displayName: string;
  formattedAddress: string;
  rating: number | null;
  userRatingCount: number | null;
};

const searchResponseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: displayNameSchema,
        formattedAddress: z.string().optional(),
        rating: z.number().optional(),
        userRatingCount: z.number().optional(),
      })
    )
    .optional(),
});

/** 店名・住所などのキーワードから場所を検索する(Text Search)。 */
export const searchPlacesByText = async (textQuery: string): Promise<PlaceSearchResult[]> => {
  const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": getApiKey(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({ textQuery, languageCode: "ja" }),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }
  const parsed = searchResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Google Places APIの応答の形式が不正です: ${parsed.error.message}`);
  }
  return (parsed.data.places ?? []).map((place) => ({
    id: place.id,
    displayName: place.displayName?.text ?? "(名称不明)",
    formattedAddress: place.formattedAddress ?? "",
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
  }));
};

export type PlaceReview = {
  authorName: string;
  rating: number;
  text: string;
  relativePublishTimeDescription: string;
};

export type PlaceDetails = {
  id: string;
  displayName: string;
  formattedAddress: string;
  rating: number | null;
  userRatingCount: number | null;
  googleMapsUri: string | null;
  /** Places APIの仕様上、最大5件まで(全件取得は不可)。 */
  reviews: PlaceReview[];
};

const detailsResponseSchema = z.object({
  id: z.string(),
  displayName: displayNameSchema,
  formattedAddress: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  googleMapsUri: z.string().optional(),
  reviews: z
    .array(
      z.object({
        authorAttribution: z.object({ displayName: z.string().optional() }).optional(),
        rating: z.number().optional(),
        text: z.object({ text: z.string().optional() }).optional(),
        relativePublishTimeDescription: z.string().optional(),
      })
    )
    .optional(),
});

/** place_idから店舗の評価・口コミ(最大5件)を取得する(Place Details)。 */
export const getPlaceDetails = async (placeId: string): Promise<PlaceDetails> => {
  const res = await fetch(
    `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}?languageCode=ja&reviewsSort=newest`,
    {
      headers: {
        "X-Goog-Api-Key": getApiKey(),
        "X-Goog-FieldMask": "id,displayName,formattedAddress,rating,userRatingCount,googleMapsUri,reviews",
      },
    }
  );
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res));
  }
  const parsed = detailsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`Google Places APIの応答の形式が不正です: ${parsed.error.message}`);
  }
  const data = parsed.data;
  return {
    id: data.id,
    displayName: data.displayName?.text ?? "(名称不明)",
    formattedAddress: data.formattedAddress ?? "",
    rating: data.rating ?? null,
    userRatingCount: data.userRatingCount ?? null,
    googleMapsUri: data.googleMapsUri ?? null,
    reviews: (data.reviews ?? []).map((review) => ({
      authorName: review.authorAttribution?.displayName ?? "匿名",
      rating: review.rating ?? 0,
      text: review.text?.text ?? "",
      relativePublishTimeDescription: review.relativePublishTimeDescription ?? "",
    })),
  };
};
