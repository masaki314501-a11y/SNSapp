/**
 * 各自の無料Geminiキーをブラウザだけに保存し、Gemini呼び出しを伴うAPIリクエストに
 * 添えるためのヘルパー。サーバーには保存しない(localStorageのみ)。未設定の場合は
 * 何もせず、サーバー側で共有のGEMINI_API_KEYにフォールバックする。
 */
import { GEMINI_API_KEY_HEADER } from "./gemini/apiKeyHeader";

const STORAGE_KEY = "snsapp:gemini-api-key";

export const getStoredGeminiApiKey = (): string => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は未設定として扱う。
    return "";
  }
};

export const setStoredGeminiApiKey = (apiKey: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, apiKey.trim());
  } catch {
    // 同上、保存できなくても致命的ではないため無視する。
  }
};

export const clearStoredGeminiApiKey = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上。
  }
};

/** 保存済みのキーがあればheadersに追加して返す(無ければそのまま返す)。 */
export const withGeminiApiKeyHeader = (headers: HeadersInit = {}): HeadersInit => {
  const apiKey = getStoredGeminiApiKey();
  if (!apiKey) return headers;
  return { ...headers, [GEMINI_API_KEY_HEADER]: apiKey };
};
