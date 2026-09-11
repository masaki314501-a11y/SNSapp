import { ApiError } from "@google/genai";

/** 過負荷(503)・レート制限(429)は一時的なことが多いため、呼び出し側で再試行の対象にする。 */
export const RETRYABLE_STATUS_CODES = new Set([429, 503]);

export const isRetryableApiError = (error: unknown): boolean =>
  error instanceof ApiError && RETRYABLE_STATUS_CODES.has(error.status);

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
      return new Error(
        "Gemini APIのレート制限に達しました。しばらく時間を置いてから再度お試しください"
      );
    }
  }
  return error instanceof Error ? error : new Error("Gemini APIの呼び出しに失敗しました");
};
