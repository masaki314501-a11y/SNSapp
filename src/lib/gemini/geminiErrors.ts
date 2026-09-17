import { ApiError } from "@google/genai";

/** 過負荷(503)・レート制限(429)は一時的なことが多いため、呼び出し側で再試行の対象にする。 */
export const RETRYABLE_STATUS_CODES = new Set([429, 503]);

export const isRetryableApiError = (error: unknown): boolean =>
  error instanceof ApiError && RETRYABLE_STATUS_CODES.has(error.status);

/**
 * 429には「1分あたりの上限(すぐ回復する)」と「1日あたりの上限(翌日まで回復しない)」の
 * 2種類があり、利用者が取るべき行動が全く違う。Geminiは前者をRPM/RPS、後者をPerDayを含む
 * quotaIdとして返すため、メッセージ本文から日次上限かどうかを見分ける。
 */
export const isDailyQuotaError = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 429 &&
  /PerDay|per day|daily/i.test(typeof error.message === "string" ? error.message : "");

/** Geminiが返すRetryInfo(例: "retryDelay":"43s")から、再試行可能になるまでの秒数を取り出す。 */
export const parseRetryDelaySeconds = (error: unknown): number | null => {
  if (!(error instanceof ApiError) || typeof error.message !== "string") return null;
  const match = error.message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? Math.ceil(Number(match[1])) : null;
};

/** Gemini SDKが返す生のエラー(JSON文字列そのまま)を、画面にそのまま出しても
 *  分かるような日本語メッセージに変換する。 */
export const toFriendlyGeminiError = (error: unknown): Error => {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      return new Error(
        "Geminiが混雑しています(サーバー過負荷)。しばらく時間を置いてから再度お試しください"
      );
    }
    if (error.status === 429) {
      if (isDailyQuotaError(error)) {
        return new Error(
          "Gemini APIの1日あたりの利用上限に達しました。上限は日付が変わる頃(太平洋時間の午前0時)にリセットされます。" +
            "それまで待つか、Google AI Studioで課金を有効にして上限を引き上げてください"
        );
      }
      const retryAfterSeconds = parseRetryDelaySeconds(error);
      return new Error(
        retryAfterSeconds !== null
          ? `Gemini APIのレート制限に達しました。約${retryAfterSeconds}秒後に再度お試しください`
          : "Gemini APIのレート制限に達しました。しばらく時間を置いてから再度お試しください"
      );
    }
  }
  return error instanceof Error ? error : new Error("Gemini APIの呼び出しに失敗しました");
};
