"use client";

import { useState } from "react";
import type { PlaceDetails, PlaceSearchResult } from "@/lib/googleMaps/places";

/**
 * Google Places API(APIキーのみ・OAuth不要)で、自社・競合を問わず店舗の評価・口コミ
 * (直近最大5件、API仕様上の上限)を検索・閲覧する画面。SNS投稿の企画・ネタ探しの
 * 参考情報として使う想定で、全件収集や自動集計は行わない(仕様上できないため)。
 */
const Stars: React.FC<{ rating: number }> = ({ rating }) => {
  const rounded = Math.round(rating);
  return (
    <span aria-label={`評価 ${rating}`} style={{ letterSpacing: 1 }}>
      {"★".repeat(Math.max(0, Math.min(5, rounded)))}
      {"☆".repeat(Math.max(0, 5 - rounded))}
    </span>
  );
};

export const InsightsExplorer: React.FC = () => {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [details, setDetails] = useState<PlaceDetails | null>(null);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setDetails(null);
    setSelectedId(null);
    try {
      const res = await fetch("/api/insights/search-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "検索に失敗しました");
      setResults(data.results as PlaceSearchResult[]);
      if ((data.results as PlaceSearchResult[]).length === 0) {
        setSearchError("該当する場所が見つかりませんでした");
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "検索に失敗しました");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPlace = async (placeId: string) => {
    setSelectedId(placeId);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetails(null);
    try {
      const res = await fetch(`/api/insights/place-details/${encodeURIComponent(placeId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "店舗情報の取得に失敗しました");
      setDetails(data as PlaceDetails);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "店舗情報の取得に失敗しました");
    } finally {
      setDetailsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="step-badge">1</span>
          <h2 className="text-sm font-semibold">店舗を検索</h2>
          <span className="text-xs" style={{ color: "var(--muted-2)" }}>
            自社・競合どちらも検索できます(Googleマップに登録されている場所が対象)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearch();
            }}
            placeholder="店名・住所など(例: 渋谷 カフェ)"
            className="field-input flex-1"
            style={{ minWidth: 220 }}
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching || query.trim().length === 0}
            className="btn-primary px-4 py-1.5 text-sm"
          >
            {searching ? "検索中..." : "検索"}
          </button>
        </div>
        {searchError ? <p className="badge-pill danger w-fit">{searchError}</p> : null}
        {results.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {results.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => void handleSelectPlace(place.id)}
                  className="preset-card flex w-full flex-col gap-1 p-3 text-left"
                  style={selectedId === place.id ? { borderColor: "var(--accent)" } : undefined}
                >
                  <span className="text-sm font-semibold">{place.displayName}</span>
                  <span className="text-xs" style={{ color: "var(--muted-2)" }}>
                    {place.formattedAddress}
                  </span>
                  {place.rating !== null ? (
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
                      <Stars rating={place.rating} />
                      {place.rating.toFixed(1)}({place.userRatingCount ?? 0}件)
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {selectedId ? (
        <div className="panel flex flex-col gap-3 p-5">
          <div className="flex items-baseline gap-2.5">
            <span className="step-badge">2</span>
            <h2 className="text-sm font-semibold">評価・口コミ</h2>
            <span className="text-xs" style={{ color: "var(--muted-2)" }}>
              Google公式APIの仕様上、直近最大5件までの表示です
            </span>
          </div>
          {detailsLoading ? <span className="badge-pill warning w-fit">取得中...</span> : null}
          {detailsError ? <p className="badge-pill danger w-fit">{detailsError}</p> : null}
          {details ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-base font-semibold">{details.displayName}</span>
                <span className="text-xs" style={{ color: "var(--muted-2)" }}>
                  {details.formattedAddress}
                </span>
                {details.rating !== null ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <Stars rating={details.rating} />
                    <span style={{ color: "var(--muted)" }}>
                      {details.rating.toFixed(1)}({details.userRatingCount ?? 0}件の評価)
                    </span>
                  </span>
                ) : null}
                {details.googleMapsUri ? (
                  <a
                    href={details.googleMapsUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline w-fit"
                    style={{ color: "var(--muted)" }}
                  >
                    Googleマップで見る →
                  </a>
                ) : null}
              </div>

              {details.reviews.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {details.reviews.map((review, i) => (
                    <li key={i} className="preset-card flex flex-col gap-1.5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{review.authorName}</span>
                        <span className="text-xs" style={{ color: "var(--muted-2)" }}>
                          {review.relativePublishTimeDescription}
                        </span>
                      </div>
                      <Stars rating={review.rating} />
                      <p className="text-sm" style={{ color: "var(--foreground)" }}>
                        {review.text || "(本文なし)"}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs" style={{ color: "var(--muted-2)" }}>
                  口コミがまだありません
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
