/**
 * 各自のGeminiキー(BYOK)をクライアントからAPIルートに伝えるためのヘッダー名。
 * クライアント側(geminiApiKeyClient.ts)・サーバー側(各APIルート)の双方から参照する。
 */
export const GEMINI_API_KEY_HEADER = "X-Gemini-Api-Key";

/** APIルートで、リクエストヘッダーから各自のGeminiキーを取り出す。無ければundefined。 */
export const readGeminiApiKeyOverride = (request: Request): string | undefined => {
  const value = request.headers.get(GEMINI_API_KEY_HEADER)?.trim();
  return value ? value : undefined;
};
